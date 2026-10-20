// 離線模擬：用假 Telegram bot 驅動「真的」bot/index.ts 訊息與 callback handler。
//
// - node-telegram-bot-api 被換成 FakeBot（記錄 sendMessage / deleteMessage / editMessageText ...），
//   完全不連 Telegram。
// - LLM 走本地 stub HTTP server（OLLAMA_BASE_URL 指過去；CLAUDE_BRIDGE_URL 指向不通的位址以觸發
//   fallback），完全不連真的 LLM。
// - DB 是 docker-data/dev.db 的臨時複本（只寫複本，永遠不寫原檔）；所有測試資料掛在獨立的
//   「模擬商行」租戶底下，不碰任何真實業務資料。
//
// 用途：重構 bot/index.ts（拆檔）前後各跑一次，用 SIM_TRANSCRIPT_OUT 輸出回覆逐字稿，
// 兩份 diff 必須一致。
//
// Run: DATABASE_URL=file:.../docker-data/dev.db npx tsx --test bot/simulate.test.ts
//      （要輸出逐字稿：加 SIM_TRANSCRIPT_OUT=/path/to/out.jsonl）
// 列在 scripts/run-tests.ts 的 DB_TESTS（需要 dev.db 複本）：本機 npm run test 會跑，CI（TEST_SKIP_DB=1）略過。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Call = { op: string; chatId?: number | string; text?: string; extra?: unknown };

const PASSWORDS = {
    writer: 'SimPass-123',
    victim: 'SimVictim-456',
    disabled: 'SimDisabled-789',
    demote: 'SimDemote-321',
    reader: 'SimReader-654',
    wrong: ['WrongGuessA1', 'WrongGuessB2', 'WrongGuessC3', 'WrongGuessD4', 'WrongGuessE5', 'WrongGuessF6', 'WrongGuessG7'],
};

class FakeBot extends EventEmitter {
    static last: FakeBot | null = null;
    calls: Call[] = [];
    failDelete = false;
    private nextMsgId = 9000;
    constructor(_token: string, _opts?: unknown) {
        super();
        FakeBot.last = this;
    }
    async startPolling() { /* no-op */ }
    async sendMessage(chatId: number, text: string, extra?: any) {
        this.calls.push({ op: 'sendMessage', chatId, text, extra: summarizeExtra(extra) });
        return { message_id: ++this.nextMsgId, chat: { id: chatId } };
    }
    async deleteMessage(chatId: number, messageId: number) {
        this.calls.push({ op: 'deleteMessage', chatId, text: String(messageId) });
        if (this.failDelete) throw new Error('ETELEGRAM: 400 Bad Request: message can\'t be deleted');
        return true;
    }
    async answerCallbackQuery(id: string) {
        this.calls.push({ op: 'answerCallbackQuery', text: id });
        return true;
    }
    async editMessageText(text: string, opts?: any) {
        this.calls.push({ op: 'editMessageText', chatId: opts?.chat_id, text, extra: summarizeExtra(opts) });
        return true;
    }
}

function summarizeExtra(extra: any): unknown {
    if (!extra) return undefined;
    const out: Record<string, unknown> = {};
    if (extra.parse_mode) out.parse_mode = extra.parse_mode;
    const kb = extra.reply_markup?.inline_keyboard;
    if (kb) out.keyboard = kb.map((row: any[]) => row.map((b: any) => `${b.text}=>${b.callback_data}`));
    return Object.keys(out).length ? out : undefined;
}

// 把 cuid 之類隨機 id 正規化，讓兩次執行的逐字稿可以直接 diff
function normalize(s: string): string {
    return s.replace(/\bc[a-z0-9]{24}\b/g, '<id>');
}

test('offline simulation: login throttle, session revalidation, query, entry flow', async (t) => {
    // ── 環境（必須在 require 任何 bot / prisma 模組之前設好）──
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-sim-'));
    const dbCopy = path.join(work, 'sim.db');
    const srcDb = path.resolve(__dirname, '..', 'docker-data', 'dev.db');
    fs.copyFileSync(srcDb, dbCopy);
    // dev.db 複本可能比 schema 舊（例如缺 BotMessageLog 表）：對「複本」補齊 schema，絕不碰原檔
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
        env: { ...process.env, DATABASE_URL: `file:${dbCopy.split(path.sep).join('/')}` },
        stdio: 'ignore',
        shell: process.platform === 'win32',
    });
    const dataDir = path.join(work, 'data');
    fs.mkdirSync(dataDir);

    const llmServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            let user = '';
            try { user = JSON.parse(body).messages?.[1]?.content ?? ''; } catch { /* ignore */ }
            let content: unknown = { entries: [] };
            if (user.includes('新廠商丙')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '測試肝連', quantity: 1, unit: '台斤', price: 77, vendorName: '新廠商丙', note: null, rawInput: user }] };
            } else if (user.includes('雜支')) {
                content = { entries: [{ type: 'EXPENSE', itemName: '雜支', quantity: null, unit: null, price: 100, vendorName: null, note: null, rawInput: user }] };
            } else if (user.includes('胡椒粉')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '胡椒粉', quantity: 1, unit: '個', price: 30, vendorName: null, note: null, rawInput: user }] };
            } else if (user.includes('芥末粉')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '芥末粉', quantity: 1, unit: '個', price: 40, vendorName: null, note: null, rawInput: user }] };
            } else if (user.includes('測試肝連')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '測試肝連', quantity: 2.6, unit: '台斤', price: 218, vendorName: null, note: null, rawInput: user }] };
            } else if (user.includes('鱷梨醬')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '鱷梨醬', quantity: 3, unit: '個', price: 90, vendorName: null, note: null, rawInput: user }] };
            } else if (user.includes('山葵醬')) {
                content = { entries: [{ type: 'PURCHASE', itemName: '山葵醬', quantity: 2, unit: '個', price: 60, vendorName: null, note: null, rawInput: user }] };
            }
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ message: { content: JSON.stringify(content) } }));
        });
    });
    await new Promise<void>((r) => llmServer.listen(0, '127.0.0.1', r));
    const transcript: string[] = [];
    t.after(() => {
        llmServer.close();
        if (process.env.SIM_TRANSCRIPT_OUT) fs.writeFileSync(process.env.SIM_TRANSCRIPT_OUT, transcript.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
    });
    const llmPort = (llmServer.address() as { port: number }).port;

    process.env.DATABASE_URL = `file:${dbCopy.split(path.sep).join('/')}`;
    process.env.BOT_DATA_DIR = dataDir;
    process.env.TELEGRAM_BOT_TOKEN = 'sim-token';
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${llmPort}`;
    process.env.CLAUDE_BRIDGE_URL = 'http://127.0.0.1:1';
    process.env.CLAUDE_BRIDGE_TIMEOUT_MS = '2000';
    process.env.LLM_PROVIDER = 'claude';
    delete process.env.CLAUDE_BRIDGE_TOKEN;
    delete process.env.JEV_API_KEY;

    // ── 換掉 node-telegram-bot-api ──
    const req: NodeRequire = require;
    const tgId = req.resolve('node-telegram-bot-api');
    (req.cache as any)[tgId] = { id: tgId, filename: tgId, loaded: true, exports: FakeBot, children: [], paths: [] };

    const prisma = req('../src/lib/prisma').default as import('@prisma/client').PrismaClient;
    const { hashPassword } = req('../src/lib/password');
    t.after(async () => {
        await prisma.$disconnect();
        try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* sqlite may still hold the file on Windows */ }
        setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
    });

    // ── 種子資料（獨立租戶）──
    const TENANT = 'sim-tenant';
    await prisma.tenant.create({ data: { id: TENANT, name: '模擬商行', code: 'sim-tenant', status: true } });
    await prisma.category.create({ data: { id: 'sim-cat', name: '模擬分類', tenantId: TENANT } });
    await prisma.item.create({ data: { id: 'sim-item-liver', name: '測試肝連', categoryId: 'sim-cat', defaultUnit: 'tj', tenantId: TENANT } });
    await prisma.dictionary.create({ data: { category: 'unit', value: 'tj', label: '台斤', meta: JSON.stringify({ toKg: 0.6 }), tenantId: TENANT } });
    await prisma.dictionary.create({ data: { category: 'unit', value: 'pc', label: '個', tenantId: TENANT } });
    await prisma.dictionary.create({ data: { category: 'expense_type', value: 'EXP001', label: '薪資', tenantId: TENANT } });
    await prisma.vendor.create({ data: { id: 'sim-vendor', name: '模擬海豐', tenantId: TENANT } });
    await prisma.location.create({ data: { id: 'sim-loc', name: '模擬攤', tenantId: TENANT } });

    async function role(code: string) {
        const found = await prisma.role.findFirst({ where: { code } });
        return found ?? prisma.role.create({ data: { name: `sim-${code}`, code } });
    }
    const roles = { admin: await role('admin'), write: await role('write'), read: await role('read') };
    async function mkUser(id: string, username: string, password: string, realName: string, roleCode: 'write' | 'read') {
        await prisma.user.create({
            data: { id, username, password: hashPassword(password), realName, status: true, tenantId: TENANT },
        });
        await prisma.userRole.create({ data: { userId: id, roleId: roles[roleCode].id } });
    }
    await mkUser('sim-u-writer', 'sim-writer', PASSWORDS.writer, '模擬記帳員', 'write');
    await mkUser('sim-u-victim', 'sim-victim', PASSWORDS.victim, '模擬受害者', 'write');
    await mkUser('sim-u-disabled', 'sim-disabled', PASSWORDS.disabled, '模擬停用者', 'write');
    await mkUser('sim-u-demote', 'sim-demote', PASSWORDS.demote, '模擬降權者', 'write');
    await mkUser('sim-u-reader', 'sim-reader', PASSWORDS.reader, '模擬唯讀者', 'read');

    // ── 載入真的 bot（會 new FakeBot 並註冊 handler）──
    req('./index');
    const bot = FakeBot.last!;
    assert.ok(bot, 'index.ts 必須建立 bot');
    await sleep(600);          // 讓啟動流程（preloadStates / bridge health check）跑完
    bot.calls.length = 0;      // 啟動雜訊不進逐字稿

    // ── 驅動工具 ──
    let seq = 100;
    async function settle() {
        let last = -1;
        for (let i = 0; i < 40; i++) {
            await sleep(60);
            if (bot.calls.length === last) return;
            last = bot.calls.length;
        }
    }
    function flush(label: string) {
        transcript.push(`## ${label}`);
        for (const c of bot.calls) transcript.push(normalize(JSON.stringify(c)));
        bot.calls.length = 0;
    }
    async function say(label: string, tg: number, text: string) {
        const msg = { message_id: ++seq, chat: { id: tg, type: 'private' }, from: { id: tg, username: `tg${tg}` }, text, date: 0 };
        await (bot.listeners('message')[0] as any)(msg);
        await settle();
        const out = bot.calls.slice();
        flush(`${label} | tg${tg} says: ${text.replace(/\S+$/, (w) => (Object.values(PASSWORDS).flat().includes(w) ? '[pw]' : w))}`);
        return out;
    }
    async function press(label: string, tg: number, data: string) {
        const q = { id: `cb${++seq}`, from: { id: tg }, message: { message_id: seq, chat: { id: tg } }, data };
        await (bot.listeners('callback_query')[0] as any)(q);
        await settle();
        const out = bot.calls.slice();
        flush(`${label} | tg${tg} presses: ${data}`);
        return out;
    }
    const texts = (calls: Call[]) => calls.filter((c) => c.op === 'sendMessage').map((c) => c.text ?? '');
    const count = (op: string, calls: Call[]) => calls.filter((c) => c.op === op).length;

    // 1. 未登入者傳非登入格式訊息
    let out = await say('unknown user, non-login text', 5001, '今天肝連2.6台斤218');
    assert.ok(texts(out).some((x) => x.includes('請先登入')), 'unknown user is asked to log in');
    out = await say('unknown user /help', 5001, '/help');
    assert.ok(texts(out).some((x) => x.includes('使用說明')));

    // 2. 錯誤密碼 x6 -> 鎖定
    const lockTexts: string[] = [];
    for (let i = 0; i < 6; i++) {
        out = await say(`wrong password #${i + 1}`, 5001, `sim-victim ${PASSWORDS.wrong[i]}`);
        assert.equal(count('deleteMessage', out), 1, 'login message must be deleted on every attempt');
        lockTexts.push(...texts(out));
    }
    assert.ok(lockTexts.some((x) => x.includes('帳號或密碼錯誤')), 'early attempts say wrong password');
    assert.ok(lockTexts[lockTexts.length - 1].includes('請等'), 'sixth attempt gets a plain wait message');
    assert.ok(lockTexts.some((x) => x.includes('已暫時鎖定')), 'fifth failure announces the lockout');

    // 3. 攻擊者的 telegram 帳號被鎖，不影響帳號主人用自己的 telegram 帳號登入
    //    （帳號名稱門檻 MAX_USERNAME_FAILURES 比單一 telegram 帳號寬）
    out = await say('owner telegram id, same username, correct password', 5002, `sim-victim ${PASSWORDS.victim}`);
    assert.ok(texts(out).some((x) => x.includes('登入成功')), 'one attacker id cannot lock the real owner out');
    // 清掉這個 session，讓後面的步驟維持原本的起始狀態
    await prisma.systemConfig.deleteMany({ where: { key: 'tg_session_5002' } });
    await say('owner logs out of sim state', 5002, '/logout');

    // 4. 正確登入 -> session + 訊息被刪
    bot.failDelete = true;
    out = await say('login with delete failing', 5004, `sim-reader ${PASSWORDS.reader}`);
    assert.ok(texts(out).some((x) => x.includes('唯讀')), 'read-only account refused');
    bot.failDelete = false;
    out = await say('correct login', 5003, `sim-writer ${PASSWORDS.writer}`);
    assert.equal(count('deleteMessage', out), 1);
    assert.ok(texts(out).some((x) => x.includes('登入成功')));
    assert.ok(await prisma.systemConfig.findFirst({ where: { key: 'tg_session_5003' } }), 'session persisted');

    // 5. 查詢類
    out = await say('/help logged in', 5003, '/help');
    assert.ok(texts(out)[0].includes('使用說明'));
    out = await say('/today', 5003, '/today');
    assert.equal(texts(out).length, 1);
    out = await say('query: 今天', 5003, '今天');
    assert.ok(texts(out).length >= 1);
    out = await say('/menu', 5003, '/menu');
    assert.ok(out.some((c) => JSON.stringify(c.extra ?? '').includes('q:r:entries:d0:none')));
    out = await press('menu button', 5003, 'q:r:entries:d0:none');
    assert.ok(texts(out).length >= 1);
    out = await press('menu nav', 5003, 'q:s1');
    out = await say('query: 本月營業額', 5003, '本月營業額');
    assert.ok(texts(out).length >= 1);
    out = await say('natural language query (LLM stub gives nothing)', 5003, '上個月誰賣最多？');
    assert.ok(texts(out).length >= 1);
    out = await say('ambiguous date', 5003, '3/3 肝連');
    out = await press('intent_query', 5003, 'intent_query');

    // 6. 記帳：bridge 不通 -> fallback stub LLM -> 一定要確認 -> 按確認 -> 寫入 Entry
    const entriesBefore = await prisma.entry.count({ where: { tenantId: TENANT } });
    out = await say('entry via fallback (needs confirmation)', 5003, '測試肝連2.6台斤218');
    assert.ok(out.some((c) => JSON.stringify(c.extra ?? '').includes('confirm_yes_0')), 'confirm button shown');
    out = await press('confirm yes', 5003, 'confirm_yes_0');
    assert.ok(out.some((c) => JSON.stringify(c.extra ?? '').includes('vendor_select_sim-vendor')), 'vendor choice offered');
    out = await press('pick vendor', 5003, 'vendor_select_sim-vendor');
    const entriesAfter = await prisma.entry.count({ where: { tenantId: TENANT } });
    assert.equal(entriesAfter, entriesBefore + 1, 'confirm callback inserts exactly one Entry');

    // 6b. 直接走 ollama provider -> 已知品項自動存
    process.env.LLM_PROVIDER = 'ollama';
    out = await say('/mute on', 5003, '/mute');
    out = await say('entry via ollama (auto save, muted)', 5003, '測試肝連2.6台斤219');
    assert.equal(await prisma.entry.count({ where: { tenantId: TENANT } }), entriesBefore + 2, 'auto-saved entry inserted');
    // 6c. /mute 關閉，再走未知品項 -> 新增品項 -> 選分類 -> 不填廠商
    out = await say('/mute off', 5003, '/mute');
    out = await say('unknown item', 5003, '鱷梨醬3個90');
    out = await press('confirm unknown item', 5003, 'confirm_yes_0');
    assert.ok(out.some((c) => JSON.stringify(c.extra ?? '').includes('new_purchase_create')), 'unknown item prompt');
    out = await press('new purchase item', 5003, 'new_purchase_create');
    out = await press('pick category', 5003, 'cat_select_sim-cat');
    out = await press('skip vendor', 5003, 'vendor_skip');
    assert.ok(await prisma.item.findFirst({ where: { tenantId: TENANT, name: '鱷梨醬' } }), 'new item created');
    assert.equal(await prisma.entry.count({ where: { tenantId: TENANT } }), entriesBefore + 3, 'entry saved after new item flow');
    // 6d. 未知品項 -> 新增為支出費用
    out = await say('unknown item as expense', 5003, '山葵醬2個60');
    out = await press('confirm unknown expense item', 5003, 'confirm_yes_0');
    out = await press('new expense type', 5003, 'new_expense_create');
    // 6e. 文字回覆路徑（確認流程中用文字回答）
    process.env.LLM_PROVIDER = 'claude';
    out = await say('entry for text replies', 5003, '測試肝連2.6台斤220');
    out = await say('free text during confirmation', 5003, '隨便打字');
    out = await say('yes by text', 5003, '是');
    out = await say('skip vendor by text', 5003, '略過');
    process.env.LLM_PROVIDER = 'claude';

    // 6f. 其餘狀態機分支：文字搜尋品項、分類/新廠商/支出類型子流程、新增廠商 callback
    process.env.LLM_PROVIDER = 'ollama';
    out = await say('unknown item, will search by text', 5003, '胡椒粉1個30');
    out = await press('confirm', 5003, 'confirm_yes_0');
    out = await say('retype item name (search)', 5003, '測試肝連');
    out = await say('unknown item, new purchase + typed vendor', 5003, '芥末粉1個40');
    out = await press('confirm', 5003, 'confirm_yes_0');
    out = await press('new purchase item', 5003, 'new_purchase_create');
    out = await say('text during category select', 5003, '隨便打');
    out = await press('pick category', 5003, 'cat_select_sim-cat');
    out = await press('vendor create prompt', 5003, 'vendor_create_prompt');
    out = await say('typed new vendor name', 5003, '新廠商乙');
    assert.ok(await prisma.vendor.findFirst({ where: { tenantId: TENANT, name: '新廠商乙' } }), 'vendor created from typed name');
    out = await say('purchase with unknown vendor', 5003, '測試肝連1台斤77 新廠商丙');
    out = await press('confirm', 5003, 'confirm_yes_0');
    out = await press('vendor_create callback', 5003, 'vendor_create');
    out = await say('expense without type', 5003, '雜支100');
    out = await press('confirm', 5003, 'confirm_yes_0');
    out = await say('text while choosing expense type', 5003, '隨便');
    out = await press('pick expense type', 5003, 'expense_type_select_EXP001');
    out = await say('text while confirming expense', 5003, '隨便');
    out = await press('reselect', 5003, 'expense_reselect');
    out = await press('pick expense type again', 5003, 'expense_type_select_EXP001');
    out = await press('save expense', 5003, 'expense_save_confirm');
    out = await say('reject flow', 5003, '芥末粉1個40');
    out = await press('reject', 5003, 'confirm_no_0');
    out = await press('stale callback', 5003, 'new_item_yes');
    process.env.LLM_PROVIDER = 'claude';

    // 7. 停用 / 降權 的既有 session 下一則訊息就被拒
    out = await say('login disabled-to-be', 5005, `sim-disabled ${PASSWORDS.disabled}`);
    assert.ok(texts(out).some((x) => x.includes('登入成功')));
    out = await say('login demote-to-be', 5006, `sim-demote ${PASSWORDS.demote}`);
    assert.ok(texts(out).some((x) => x.includes('登入成功')));

    await prisma.user.update({ where: { id: 'sim-u-disabled' }, data: { status: false } });
    out = await say('disabled user next message', 5005, '/today');
    assert.ok(texts(out).some((x) => x.includes('請先登入')), 'disabled user rejected');
    assert.equal(await prisma.systemConfig.findFirst({ where: { key: 'tg_session_5005' } }), null, 'disabled user session removed');
    out = await say('disabled user entry', 5005, '測試肝連2.6台斤218');
    assert.ok(!out.some((c) => (c.text ?? '').includes('解析中')), 'disabled user cannot reach the parser');
    out = await press('disabled user callback', 5005, 'confirm_yes_0');
    assert.ok(texts(out).some((x) => x.includes('會話已過期')));

    await prisma.userRole.deleteMany({ where: { userId: 'sim-u-demote' } });
    await prisma.userRole.create({ data: { userId: 'sim-u-demote', roleId: roles.read.id } });
    out = await say('demoted user next message', 5006, '測試肝連2.6台斤218');
    assert.ok(!out.some((c) => (c.text ?? '').includes('解析中')), 'write->read user loses write');

    // 8. logout
    out = await say('/logout', 5003, '/logout');
    assert.ok(texts(out).some((x) => x.includes('已登出')));
    assert.equal(await prisma.systemConfig.findFirst({ where: { key: 'tg_session_5003' } }), null);

    // ── 密碼不得出現在 bot.log、BotMessageLog、對話狀態 ──
    await sleep(300);
    const secrets = Object.values(PASSWORDS).flat();
    const logFile = path.join(dataDir, 'bot.log');
    assert.ok(fs.existsSync(logFile), 'bot.log should exist');
    const logText = fs.readFileSync(logFile, 'utf8');
    for (const s of secrets) assert.ok(!logText.includes(s), `bot.log must not contain a password (${s.slice(0, 6)}...)`);
    assert.ok(logText.includes('[password redacted]'), 'login lines are redacted in bot.log');
    const dbLogs = JSON.stringify(await prisma.botMessageLog.findMany({ where: { chatId: { in: ['5001', '5002', '5003', '5004', '5005', '5006'] } } }));
    for (const s of secrets) assert.ok(!dbLogs.includes(s), 'BotMessageLog must not contain a password');
    const states = JSON.stringify(await prisma.systemConfig.findMany({ where: { key: { startsWith: 'tg_state_' } } }));
    for (const s of secrets) assert.ok(!states.includes(s), 'persisted chat state must not contain a password');
    // 攻擊者那個 telegram 帳號的計數留著；帳號名稱的計數在主人登入成功時清掉
    const attackerRow = await prisma.systemConfig.count({ where: { key: 'login_throttle_tg_5001' } });
    assert.equal(attackerRow, 1, 'throttle counters persisted in SystemConfig');

    t.diagnostic(`transcript lines: ${transcript.length}`);

});

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
