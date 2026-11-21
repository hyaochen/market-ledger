// process 內的滑動視窗頻率限制（純邏輯，可注入時鐘）。
//
// 兩個用途：
//   - unauthMessageLimiter：沒有 session 的 Telegram 帳號私訊頻率（每分鐘 6 則、每小時 30 則），
//     超過就在任何 DB 寫入之前丟棄，避免陌生人灌爆共用的 SQLite。
//   - llmCallLimiter：每個 Telegram 帳號的 LLM 呼叫頻率（5 分鐘 40 次），LLM 走 owner 的訂閱額度。
//
// 只有「被放行」的請求會記進視窗；被拒絕的不記，所以持續灌訊息不會把封鎖時間越延越長。

export type RateWindow = { ms: number; max: number };

export type RateDecision = {
    allowed: boolean;
    /** 被拒絕時：這次是不是這一輪封鎖的第一次拒絕（呼叫端只在 true 時回一次提示，之後靜默）。 */
    notify: boolean;
};

export class WindowRateLimiter {
    private hits = new Map<string, number[]>();
    private notified = new Map<string, number>();
    private longest: number;

    constructor(
        private windows: RateWindow[],
        private maxKeys: number = 5000,
        private now: () => number = Date.now,
    ) {
        this.longest = Math.max(...windows.map(w => w.ms));
    }

    /** 測試用：換掉時鐘。 */
    setClock(now: () => number): void { this.now = now; }

    reset(): void { this.hits.clear(); this.notified.clear(); }

    get size(): number { return this.hits.size; }

    /** 試著消耗 cost 次額度；cost 次全部放得下才放行並記錄。 */
    tryConsume(key: string, cost = 1): RateDecision {
        const t = this.now();
        const prev = this.hits.get(key) ?? [];
        const stamps = prev.filter(ts => t - ts < this.longest);

        for (const w of this.windows) {
            const inWindow = stamps.filter(ts => t - ts < w.ms).length;
            if (inWindow + cost > w.max) {
                // 存回修剪過的陣列（不含這次），維持 Map 的插入順序不動
                if (this.hits.has(key)) this.hits.set(key, stamps);
                const lastNotified = this.notified.get(key);
                const notify = lastNotified === undefined || t - lastNotified >= w.ms;
                if (notify) this.setNotified(key, t);
                return { allowed: false, notify };
            }
        }

        for (let i = 0; i < cost; i++) stamps.push(t);
        // delete 再 set：讓最近有動作的 key 排到 Map 尾端，淘汰時先丟最舊的
        this.hits.delete(key);
        this.hits.set(key, stamps);
        this.evict();
        return { allowed: true, notify: false };
    }

    private setNotified(key: string, t: number): void {
        this.notified.delete(key);
        this.notified.set(key, t);
        while (this.notified.size > this.maxKeys) {
            const oldest = this.notified.keys().next().value;
            if (oldest === undefined) break;
            this.notified.delete(oldest);
        }
    }

    private evict(): void {
        while (this.hits.size > this.maxKeys) {
            const oldest = this.hits.keys().next().value;
            if (oldest === undefined) break;
            this.hits.delete(oldest);
        }
    }
}

// 沒有 session 的私訊：每分鐘 6 則、每小時 30 則
export const UNAUTH_PER_MINUTE = 6;
export const UNAUTH_PER_HOUR = 30;
export const RATE_MAX_KEYS = 5000;
export const unauthMessageLimiter = new WindowRateLimiter([
    { ms: 60 * 1000, max: UNAUTH_PER_MINUTE },
    { ms: 60 * 60 * 1000, max: UNAUTH_PER_HOUR },
], RATE_MAX_KEYS);

// 每個 telegram id 的 LLM 呼叫：5 分鐘 40 次。
// 逐行重試最壞情況是一則訊息 1 + 20 次（見 parser.ts MAX_RETRY_LINES），遠低於上限。
export const LLM_CALLS_PER_WINDOW = 40;
export const LLM_WINDOW_MS = 5 * 60 * 1000;
export const llmCallLimiter = new WindowRateLimiter([
    { ms: LLM_WINDOW_MS, max: LLM_CALLS_PER_WINDOW },
], RATE_MAX_KEYS);

export const UNAUTH_RATE_TEXT = '訊息太頻繁，請稍後再試。';
export const LLM_RATE_TEXT = '查詢與記帳太頻繁，請稍後再試。';
