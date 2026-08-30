// T-ML-031: liveness heartbeat for the bot container's Docker healthcheck.
//
// 🔴 為什麼不能比照 web（T-ML-030 的 /api/health）那樣「打一個 endpoint / 開一個 process
// 去查 DB」：主控 2026-08-11 20:00 實測發現，在容器內用 `docker exec` 另開一個
// node/tsx process 去開同一個 WAL DB，會穩定拿到 `SqliteError 522: disk I/O error`
// （2/2 重現）；但同一時間 bot 本體長駐 process 用既有連線完全正常服務中（mom 19:50:39
// 的登入 log 後面沒有跟任何 error）。詳見 vault/projects/market-ledger/bugs-log.md
// 2026-08-11「🔬 事後追查補充」。
//
// 結論：失效的單位是「連線」不是「容器」。任何 healthcheck 若用新 process/新連線去查
// DB，會被這個現象騙成「假 unhealthy」——看門狗因此無限重啟一個其實健康的 bot，直接
// 打斷正在記帳的使用者，比完全沒有監控更糟。
//
// 所以這裡完全不開新連線：bot 主流程呼叫 startHeartbeat() 一次，之後每 60 秒用「自己
// 現有的」Prisma 連線（跟 bot/index.ts、bot/bridgeHealth.ts 匯入的是 src/lib/prisma.ts
// 同一個 singleton）做一次輕量查詢，成功就把時間戳寫進 /tmp/bot-heartbeat。
// docker-compose.yml 的 healthcheck 只檢查這個檔案夠不夠新鮮（見該檔註解），全程是
// 純檔案系統操作，不碰網路、不碰 DB、不啟動任何新 process。
//
// 寫入位置刻意選 /tmp（容器可寫層），不是 /app/data（Windows bind mount）——bind mount
// 正是 2026-08-11 事故根因的所在地，心跳檔完全不需要跟它扯上關係。
//
// 這個檔案只用 dependency injection 測試（跟 bot/bridgeHealth.ts 同一原則）：
// runHeartbeatTick() 的預設值才會碰真的 Prisma / fs，單元測試一律注入假的
// query/writeFile，永遠不會在 `npm run test` 期間對 dev.db 開出任何一條新連線。

import fs from 'fs';
import prisma from '../src/lib/prisma';

/** 心跳檔路徑。docker-compose.yml 的 healthcheck test 指令寫死同一個路徑，改動時兩邊要一起改。 */
export const HEARTBEAT_FILE = '/tmp/bot-heartbeat';

/** 每 60 秒一次；docker-compose.yml 的新鮮度門檻設 180 秒（3x），吸收單次 tick 被事件迴圈延遲或單次查詢失敗的雜訊。 */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export type HeartbeatTickDeps = {
    /** 預設 = 用既有 Prisma 連線做一次輕量查詢。測試一律覆寫，不碰真的 DB。 */
    query?: () => Promise<unknown>;
    /** 預設 = fs.writeFileSync。測試一律覆寫，不碰真的檔案系統。 */
    writeFile?: (file: string, contents: string) => void;
    /** 預設 = Date.now。可覆寫供測試斷言確切時間戳。 */
    now?: () => number;
    /** 預設 = HEARTBEAT_FILE。測試可覆寫成假路徑。 */
    file?: string;
};

export type HeartbeatTickResult = { ok: true } | { ok: false; error: string };

/**
 * 心跳單次執行：查詢成功才寫檔，查詢失敗「刻意不寫檔」讓檔案自然變舊——不寫入一個
 * 「看起來新鮮但其實是失敗記錄」的時間戳，靠 docker healthcheck 的新鮮度判斷即可，
 * 不需要在檔案內容裡額外編碼成功/失敗狀態。
 */
export async function runHeartbeatTick(deps: HeartbeatTickDeps = {}): Promise<HeartbeatTickResult> {
    const {
        query = () => prisma.$queryRaw`SELECT 1`,
        writeFile = (file, contents) => { fs.writeFileSync(file, contents); },
        now = Date.now,
        file = HEARTBEAT_FILE,
    } = deps;

    try {
        await query();
        writeFile(file, String(now()));
        return { ok: true };
    } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        console.warn('[bot/heartbeat] tick failed (heartbeat file left stale, will retry next interval):', message);
        return { ok: false, error: message };
    }
}

export type StartHeartbeatOptions = HeartbeatTickDeps & { intervalMs?: number };

/**
 * 從 bot/index.ts 啟動時呼叫一次。立刻跑一次 tick（不等第一個 60 秒），之後每
 * intervalMs 跑一次。回傳 stop()，正常執行時不需要呼叫（bot 是常駐 process），
 * 只有測試會呼叫 stop() 清掉 timer 避免 node:test 卡住。
 */
export function startHeartbeat(options: StartHeartbeatOptions = {}): { stop: () => void } {
    const { intervalMs = HEARTBEAT_INTERVAL_MS, ...tickDeps } = options;

    void runHeartbeatTick(tickDeps);
    const timer = setInterval(() => { void runHeartbeatTick(tickDeps); }, intervalMs);
    // unref：心跳 timer 本身不該是「讓 process 活著」的理由——如果 Telegram polling
    // 等其他 keep-alive 的來源都沒了，process 該正常結束讓 docker restart:unless-stopped
    // 接手，而不是被一個心跳 timer 硬撐著。
    timer.unref?.();

    return { stop: () => clearInterval(timer) };
}
