#!/usr/bin/env node
'use strict';

/**
 * claude-bridge — host-side HTTP service wrapping `claude -p` (Pro/Max subscription
 * auth) for the market-ledger Telegram bot (T-ML-024).
 *
 * The bot runs inside Docker and has no `claude` CLI or subscription credentials.
 * This bridge runs on the HOST (where `claude` is logged in), and the bot container
 * calls it over HTTP via `host.docker.internal`, exactly the same pattern already
 * used for the host Ollama instance (OLLAMA_BASE_URL=http://host.docker.internal:11434).
 *
 * 🔴 SECURITY — bind is hardcoded to 127.0.0.1 and NOT configurable via env.
 * The wiki project's `rag/claude_bridge.py` once bound 0.0.0.0 and let any device
 * on the LAN call it with no auth, silently burning the owner's subscription quota.
 * Do not "fix" this by adding a BIND env var — see README.md.
 *
 * Docker Desktop's host.docker.internal DOES reach services bound only to
 * 127.0.0.1 on the host (verified empirically here: Ollama is 127.0.0.1:11434-only
 * and the bot container already talks to it fine through host.docker.internal).
 * This is Docker Desktop network-proxy behavior, different from a bare Linux host.
 *
 * Run:   node scripts/claude-bridge/bridge.js
 * Stop:  Ctrl+C (SIGINT/SIGTERM handled)
 * See README.md for details.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── 設定 ──────────────────────────────────────────────────────────────
// BIND 刻意不讀環境變數，永遠 127.0.0.1。
const BIND = '127.0.0.1';
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT) || 5055;
const MODEL = process.env.CLAUDE_BRIDGE_MODEL || 'sonnet';
const MAX_CONCURRENT = Number(process.env.CLAUDE_BRIDGE_MAX_CONCURRENT) || 2;
// 單一請求的總預算（含排隊等待 + claude 執行時間）。刻意小於呼叫端（parser.ts）
// 的 30s fetch timeout，讓 bridge 有機會回一個乾淨的錯誤 JSON，而不是被呼叫端
// AbortSignal 直接掐斷、bridge 這邊的 subprocess 變成孤兒繼續跑。
const REQUEST_BUDGET_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS) || 25000;

// ── 找出真正可以 shell:false 直接 spawn 的 claude 執行檔 ─────────────────
// 🔴 踩坑記錄（T-ML-024）：Windows 上 `claude` 在 PATH 裡是 claude.cmd（批次檔）。
// Node 的 child_process.spawn 對 .cmd 檔案強制要求 shell:true（否則直接 EINVAL），
// 但 shell:true 在 Windows 上「不會」對陣列 args 做跳脫，只會用空白直接 join 後
// 丟給 cmd.exe —— 一旦某個 arg 含空白、中文、JSON 特殊字元（我們的 --system-prompt
// 剛好三者都有），cmd.exe 的 tokenizer 會把它切爛，claude 收到的參數位置全部
// 錯位。實測現象：不會報錯，但 --system-prompt 的內容形同沒生效，claude 退回
// 「一般 Claude Code agent」行為（反問使用者「你要我做什麼」），且明顯變慢
// （~7.5s vs 正常 ~4-5s）。裝作正常但結果是錯的，非常難排查。
// 修法：claude.cmd 只是個 shim，內容是 `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*`。
// 直接找到底層那個 .exe，用 shell:false 呼叫它 —— Node 對非 shell spawn 的
// Windows 參數跳脫是正確、有測試覆蓋的，中文/空白/JSON 都不會被咬。
function resolveClaudeBin() {
    if (process.env.CLAUDE_BRIDGE_BIN) {
        return { bin: process.env.CLAUDE_BRIDGE_BIN, shell: false };
    }
    if (process.platform !== 'win32') {
        return { bin: 'claude', shell: false };
    }
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
        const cmdPath = path.join(dir, 'claude.cmd');
        if (!fs.existsSync(cmdPath)) continue;
        try {
            const content = fs.readFileSync(cmdPath, 'utf8');
            const m = content.match(/"%dp0%\\(.+?\.exe)"/i);
            if (m) {
                const exePath = path.join(dir, m[1]);
                if (fs.existsSync(exePath)) return { bin: exePath, shell: false };
            }
        } catch { /* try next PATH dir */ }
    }
    // 找不到底層 .exe → 退回 claude.cmd + shell:true（已知有 quoting 風險，會在啟動時警告）
    return { bin: 'claude.cmd', shell: true, unsafe: true };
}

const RESOLVED_BIN = resolveClaudeBin();
const CLAUDE_BIN = RESOLVED_BIN.bin;
const CLAUDE_SHELL = RESOLVED_BIN.shell;

const AUTH_PATTERNS = /please run \/login|not authenticated|invalid api key|authentication_error|unauthorized|please log in/i;
const QUOTA_PATTERNS = /usage limit|rate limit|credit balance|quota exceeded|too many requests|overloaded/i;

// ── structured log（stdout，一行一個 JSON，方便之後用 findstr/grep 撈）────
function log(event, fields) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

// ── 並發保護：simple semaphore + 排隊逾時 ──────────────────────────────
// 同時最多 MAX_CONCURRENT 個 `claude -p` process；超過的請求排隊，
// 但整體等待時間仍受 REQUEST_BUDGET_MS 限制，逾時直接回 503（呼叫端會 fallback ollama）。
let activeCount = 0;
const queue = [];

function pump() {
    while (activeCount < MAX_CONCURRENT && queue.length > 0) {
        const item = queue.shift();
        if (Date.now() > item.deadline) {
            item.settleReject(new Error('queue_timeout'));
            continue;
        }
        activeCount++;
        item.settleResolve();
    }
}

function acquire(deadline) {
    return new Promise((resolve, reject) => {
        const item = { deadline };
        let settled = false;
        const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const idx = queue.indexOf(item);
            if (idx !== -1) queue.splice(idx, 1);
            fn(arg);
        };
        item.settleResolve = () => finish(resolve);
        item.settleReject = (e) => finish(reject, e);
        const timer = setTimeout(() => item.settleReject(new Error('queue_timeout')), Math.max(0, deadline - Date.now()));
        queue.push(item);
        pump();
    });
}

function release() {
    activeCount--;
    pump();
}

// ── 呼叫 claude -p ──────────────────────────────────────────────────
function runClaude(system, user, model, timeoutMs) {
    return new Promise((resolve, reject) => {
        const args = [
            '-p',
            '--model', model,
            '--no-session-persistence',
            '--output-format', 'text',
            // --safe-mode：關掉 CLAUDE.md / auto-memory / skills / plugins / hooks。
            // 沒有這個 flag，claude -p 仍會載入 owner 的全域 CLAUDE.md + MEMORY.md，
            // 讓 bot 的記帳解析變成「俗頭」人設在回話（會問澄清問題，還可能提到其他
            // 專案/使用者資訊），且啟動變慢很多（實測 ~26s → 加 --safe-mode 後 ~5s）。
            // 注意：不能用 --bare 代替 --safe-mode —— --bare 會強制要求 ANTHROPIC_API_KEY，
            // 不吃 OAuth，等於繞過訂閱認證，違背這個 task 的目的（wiki bridge 已踩過這雷）。
            '--safe-mode',
            '--tools', '',
            // T-ML-026 (C)：--safe-mode 的 --help 說明白紙黑字寫「Auth, model selection,
            // built-in tools, and permissions work normally」—— 它只清系統提示，不管工具。
            // 實測驗證（無 --tools/--disallowed-tools 時）：claude 真的會主動用工具讀
            // ~/.claude/CLAUDE.md 和 vault/projects/memoria/*.md，答出只寫在那些檔案裡的
            // owner 專案對照資訊。bot 只需要「文字→JSON」，不需要任何工具，所以兩層都擋：
            // --tools ''（空白名單）+ 明確 --disallowed-tools 黑名單（防未來版本新增
            // 預設開啟的工具繞過空白名單）。
            // 🔴 Windows 專屬踩坑：這台機器的 claude CLI 把 "PowerShell" 列成獨立工具
            // （不是併入 "Bash"）—— 只擋 Bash/Read/Grep/... 這種通用 Unix 清單完全沒用，
            // claude 直接改用 PowerShell 讀檔，外洩照樣發生。ToolSearch 可在執行期動態
            // 載入其他延遲工具，Agent/Skill 能開子任務拿到自己的工具權限，兩者也一併擋掉，
            // 不然只擋「看起來明顯」的檔案/網路工具還是留了側門。
            '--disallowed-tools',
            'Read', 'Grep', 'Glob', 'Bash', 'PowerShell', 'Task', 'Agent', 'Skill',
            'ToolSearch', 'WebFetch', 'WebSearch', 'Edit', 'Write', 'NotebookEdit',
            '--system-prompt', system || '你是個有用的 AI 助理。',
        ];
        const proc = spawn(CLAUDE_BIN, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: CLAUDE_SHELL, // 正常情況 false（直接呼叫 claude.exe）；見上方 resolveClaudeBin() 註解
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.kill();
            reject(Object.assign(new Error(`claude subprocess timeout >${timeoutMs}ms`), { code: 'TIMEOUT' }));
        }, timeoutMs);

        proc.stdout.on('data', (d) => { stdout += d; });
        proc.stderr.on('data', (d) => { stderr += d; });

        proc.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(Object.assign(err, { code: err.code || 'SPAWN_ERROR' }));
        });

        proc.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(Object.assign(
                    new Error(`claude exit=${code} stderr=${stderr.slice(0, 500)}`),
                    { code: 'EXEC_ERROR', stdout, stderr },
                ));
                return;
            }
            resolve(stdout.trim());
        });

        proc.stdin.write(user, 'utf8');
        proc.stdin.end();
    });
}

function classifyError(err) {
    if (err.code === 'TIMEOUT') return { status: 504, errorType: 'timeout', message: err.message };
    if (err.code === 'ENOENT' || err.code === 'SPAWN_ERROR') {
        return { status: 500, errorType: 'exec_error', message: `claude CLI 無法啟動: ${err.message}` };
    }
    if (err.code === 'EXEC_ERROR') {
        const text = `${err.stdout || ''}\n${err.stderr || ''}`;
        if (AUTH_PATTERNS.test(text)) return { status: 401, errorType: 'auth', message: err.message };
        if (QUOTA_PATTERNS.test(text)) return { status: 429, errorType: 'quota', message: err.message };
        return { status: 500, errorType: 'exec_error', message: err.message };
    }
    return { status: 500, errorType: 'exec_error', message: err.message || String(err) };
}

// ── HTTP server ─────────────────────────────────────────────────────
function respond(res, status, obj) {
    const data = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(data);
}

function handleChat(req, res) {
    const startedAt = Date.now();
    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(); // 2MB 上限防呆
    });
    req.on('end', async () => {
        let payload;
        try {
            payload = JSON.parse(body || '{}');
        } catch {
            respond(res, 400, { ok: false, errorType: 'bad_request', error: 'invalid JSON body' });
            return;
        }
        const system = typeof payload.system === 'string' ? payload.system : '';
        const user = typeof payload.user === 'string' ? payload.user : '';
        const model = typeof payload.model === 'string' && payload.model ? payload.model : MODEL;
        if (!user) {
            respond(res, 400, { ok: false, errorType: 'bad_request', error: 'missing "user" field' });
            return;
        }

        const deadline = startedAt + REQUEST_BUDGET_MS;
        log('request_received', { promptChars: user.length, model, queueLength: queue.length, activeCount });

        let releaseFn;
        try {
            await acquire(deadline);
            releaseFn = release;
        } catch {
            const waitedMs = Date.now() - startedAt;
            log('request_rejected', { reason: 'queue_timeout', waitedMs });
            respond(res, 503, { ok: false, errorType: 'busy', error: `queue timeout after ${waitedMs}ms (maxConcurrent=${MAX_CONCURRENT})` });
            return;
        }

        try {
            const remainingMs = Math.max(1000, deadline - Date.now());
            const content = await runClaude(system, user, model, remainingMs);
            const elapsedMs = Date.now() - startedAt;

            // 防呆：即使 exit=0，內容本身可能是額度/認證錯誤訊息（不一定會讓 CLI 非 0 退出）
            if (AUTH_PATTERNS.test(content)) {
                log('request_error', { elapsedMs, model, errorType: 'auth', note: 'matched in stdout despite exit=0' });
                respond(res, 401, { ok: false, errorType: 'auth', error: content.slice(0, 300), elapsedMs });
                return;
            }
            if (QUOTA_PATTERNS.test(content)) {
                log('request_error', { elapsedMs, model, errorType: 'quota', note: 'matched in stdout despite exit=0' });
                respond(res, 429, { ok: false, errorType: 'quota', error: content.slice(0, 300), elapsedMs });
                return;
            }

            log('request_done', { elapsedMs, model, contentChars: content.length });
            respond(res, 200, { ok: true, content, elapsedMs });
        } catch (err) {
            const elapsedMs = Date.now() - startedAt;
            const c = classifyError(err);
            log('request_error', { elapsedMs, model, errorType: c.errorType, error: c.message });
            respond(res, c.status, { ok: false, errorType: c.errorType, error: c.message, elapsedMs });
        } finally {
            releaseFn();
        }
    });
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        respond(res, 200, {
            ok: true,
            model: MODEL,
            maxConcurrent: MAX_CONCURRENT,
            activeCount,
            queueLength: queue.length,
            pid: process.pid,
            uptimeSec: Math.round(process.uptime()),
        });
        return;
    }
    if (req.method === 'POST' && req.url === '/chat') {
        handleChat(req, res);
        return;
    }
    respond(res, 404, { ok: false, errorType: 'not_found', error: `no route for ${req.method} ${req.url}` });
});

server.listen(PORT, BIND, () => {
    log('startup', {
        bind: BIND,
        port: PORT,
        model: MODEL,
        maxConcurrent: MAX_CONCURRENT,
        requestBudgetMs: REQUEST_BUDGET_MS,
        claudeBin: CLAUDE_BIN,
        claudeShell: CLAUDE_SHELL,
        pid: process.pid,
    });
    console.log(`[claude-bridge] listening on http://${BIND}:${PORT} (pid ${process.pid}, model=${MODEL})`);
    console.log(`[claude-bridge] claude bin: ${CLAUDE_BIN} (shell=${CLAUDE_SHELL})`);
    if (RESOLVED_BIN.unsafe) {
        console.warn('[claude-bridge] WARNING: could not locate claude.exe under a PATH dir\'s claude.cmd shim.');
        console.warn('[claude-bridge] Falling back to "claude.cmd" via shell:true — Windows cmd.exe does NOT');
        console.warn('[claude-bridge] escape array args, so prompts with spaces/CJK/JSON WILL get corrupted.');
        console.warn('[claude-bridge] Fix: set CLAUDE_BRIDGE_BIN to the real claude.exe path.');
    }
    console.log('[claude-bridge] Ctrl+C to stop');
});

function shutdown(signal) {
    log('shutdown', { signal, pid: process.pid });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
