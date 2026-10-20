// 登入失敗節流：5 次失敗 / 15 分鐘 -> 鎖 15 分鐘，重複鎖定指數退避（上限 24 小時）。
//
// 同時以「Telegram user id」與「嘗試的帳號名稱」兩把 key 計數：
//   - 只鎖 telegram id：攻擊者開多個 Telegram 帳號就繞過去
//   - 只鎖帳號名稱：攻擊者可故意鎖死 mom（repo 是 public，帳號名稱人盡皆知），所以
//     帳號名稱的門檻放寬（MAX_USERNAME_FAILURES），telegram id 維持嚴格；兩把 key 任一
//     被鎖都擋，但鎖定只影響「新登入」，已存在的 session 不受影響
// 計數存在 SystemConfig（跟 session / 對話狀態同一張表），bot 重啟不會歸零。

import { createHash } from 'node:crypto';
import prisma from '../src/lib/prisma';

export const MAX_FAILURES = 5;
// 帳號名稱跨所有 Telegram 帳號累計：門檻放寬，避免陌生人傳 5 次就把媽媽鎖在門外
export const MAX_USERNAME_FAILURES = 20;
// 超過這麼久沒更新的節流紀錄在 bot 啟動時清掉，避免攻擊者灌的帳號名稱一直留在表裡
export const STALE_MS = 2 * 24 * 60 * 60 * 1000;
export const WINDOW_MS = 15 * 60 * 1000;
export const BASE_LOCK_MS = 15 * 60 * 1000;
export const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
// 距離上次鎖定超過這麼久，退避等級歸零
export const LOCK_MEMORY_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'login_throttle_';

export type ThrottleRecord = {
    failures: number[];   // 視窗內的失敗時間戳（ms）
    lockUntil: number;    // 0 = 沒鎖
    lockCount: number;    // 累計鎖定次數（退避等級）
    lastLockAt: number;
};

export interface ThrottleStore {
    get(key: string): Promise<ThrottleRecord | null>;
    set(key: string, rec: ThrottleRecord): Promise<void>;
    del(key: string): Promise<void>;
}

export type ThrottleKeys = { telegramId: number | string; username: string };

export function telegramKey(telegramId: number | string): string {
    return `${KEY_PREFIX}tg_${telegramId}`;
}
export function usernameKey(username: string): string {
    // 存雜湊不存原字串：帳密順序打反時「帳號」其實是密碼，不能明文落進 SystemConfig；
    // 固定長度也讓攻擊者塞的任意字串不會把 key 撐大
    const digest = createHash('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 32);
    return `${KEY_PREFIX}u_${digest}`;
}

// 同一個 key 的讀-改-寫在本 process 內排隊，避免同時多筆失敗互相覆蓋（計數變少、永遠不鎖）
const keyLocks = new Map<string, Promise<unknown>>();
function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = keyLocks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    keyLocks.set(key, tail);
    void tail.then(() => { if (keyLocks.get(key) === tail) keyLocks.delete(key); });
    return run;
}

export const prismaThrottleStore: ThrottleStore = {
    async get(key) {
        const row = await prisma.systemConfig.findFirst({ where: { key, tenantId: null } });
        if (!row) return null;
        try { return JSON.parse(row.value) as ThrottleRecord; } catch { return null; }
    },
    async set(key, rec) {
        const value = JSON.stringify(rec);
        const existing = await prisma.systemConfig.findFirst({ where: { key, tenantId: null } });
        if (existing) await prisma.systemConfig.update({ where: { id: existing.id }, data: { value } });
        else await prisma.systemConfig.create({ data: { key, value, tenantId: null } });
    },
    async del(key) {
        await prisma.systemConfig.deleteMany({ where: { key, tenantId: null } });
    },
};

/** bot 啟動時呼叫：清掉兩天沒動過的節流紀錄（鎖定上限 24 小時，兩天前的紀錄必然已失效）。 */
export async function pruneStaleThrottleRows(now: number = Date.now()): Promise<number> {
    const res = await prisma.systemConfig.deleteMany({
        where: { key: { startsWith: KEY_PREFIX }, tenantId: null, updatedAt: { lt: new Date(now - STALE_MS) } },
    });
    return res.count;
}

export type LockStatus = { locked: false } | { locked: true; retryAfterMs: number };

function lockDuration(lockCount: number): number {
    // lockCount 為「這次之前」的鎖定次數：0 -> 15 分、1 -> 30 分、2 -> 60 分 ...
    return Math.min(BASE_LOCK_MS * 2 ** lockCount, MAX_LOCK_MS);
}

export function formatWait(ms: number): string {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    if (minutes < 60) return `${minutes} 分鐘`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} 小時` : `${hours} 小時 ${rest} 分鐘`;
}

export class LoginThrottle {
    constructor(
        private store: ThrottleStore = prismaThrottleStore,
        private now: () => number = Date.now,
    ) {}

    // 讀取不到（DB 出錯）一律放行：節流是加強防線，不能因為它壞掉讓媽媽登不進去
    async check(keys: ThrottleKeys): Promise<LockStatus> {
        const t = this.now();
        let worst = 0;
        for (const key of [telegramKey(keys.telegramId), usernameKey(keys.username)]) {
            try {
                const rec = await this.store.get(key);
                if (rec && rec.lockUntil > t) worst = Math.max(worst, rec.lockUntil - t);
            } catch { /* fail-open */ }
        }
        return worst > 0 ? { locked: true, retryAfterMs: worst } : { locked: false };
    }

    // 記一次失敗；回傳這次是否剛好觸發鎖定（兩把 key 任一觸發即算）
    async recordFailure(keys: ThrottleKeys): Promise<LockStatus> {
        const t = this.now();
        let worst = 0;
        const limits: Array<[string, number]> = [
            [telegramKey(keys.telegramId), MAX_FAILURES],
            [usernameKey(keys.username), MAX_USERNAME_FAILURES],
        ];
        for (const [key, max] of limits) {
            try {
                await withKeyLock(key, async () => {
                    const rec = (await this.store.get(key)) ?? { failures: [], lockUntil: 0, lockCount: 0, lastLockAt: 0 };
                    if (rec.lastLockAt && t - rec.lastLockAt > LOCK_MEMORY_MS) rec.lockCount = 0;
                    rec.failures = rec.failures.filter(ts => t - ts < WINDOW_MS);
                    rec.failures.push(t);
                    if (rec.failures.length >= max) {
                        const dur = lockDuration(rec.lockCount);
                        rec.lockUntil = t + dur;
                        rec.lockCount += 1;
                        rec.lastLockAt = t;
                        rec.failures = [];
                        worst = Math.max(worst, dur);
                    }
                    await this.store.set(key, rec);
                });
            } catch { /* fail-open */ }
        }
        return worst > 0 ? { locked: true, retryAfterMs: worst } : { locked: false };
    }

    // 登入成功：清掉這個 telegram id 與這個帳號名稱的失敗計數與退避等級
    async recordSuccess(keys: ThrottleKeys): Promise<void> {
        for (const key of [telegramKey(keys.telegramId), usernameKey(keys.username)]) {
            try { await this.store.del(key); } catch { /* ignore */ }
        }
    }
}

export const loginThrottle = new LoginThrottle();
