// 登入失敗節流：5 次失敗 / 15 分鐘 -> 鎖 15 分鐘，重複鎖定指數退避（上限 24 小時）。
//
// 同時以「Telegram user id」與「嘗試的帳號名稱」兩把 key 計數：
//   - 只鎖 telegram id：攻擊者開多個 Telegram 帳號就繞過去
//   - 只鎖帳號名稱：攻擊者可故意鎖死 mom（repo 是 public，帳號名稱人盡皆知），所以
//     兩把 key 任一被鎖都擋，但鎖定只影響「新登入」，已存在的 session 不受影響
// 計數存在 SystemConfig（跟 session / 對話狀態同一張表），bot 重啟不會歸零。

import prisma from '../src/lib/prisma';

export const MAX_FAILURES = 5;
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
    // 小寫 + 截斷：攻擊者可塞任意字串，限制 key 長度避免灌爆表
    return `${KEY_PREFIX}u_${username.trim().toLowerCase().slice(0, 64)}`;
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
        for (const key of [telegramKey(keys.telegramId), usernameKey(keys.username)]) {
            try {
                const rec = (await this.store.get(key)) ?? { failures: [], lockUntil: 0, lockCount: 0, lastLockAt: 0 };
                if (rec.lastLockAt && t - rec.lastLockAt > LOCK_MEMORY_MS) rec.lockCount = 0;
                rec.failures = rec.failures.filter(ts => t - ts < WINDOW_MS);
                rec.failures.push(t);
                if (rec.failures.length >= MAX_FAILURES) {
                    const dur = lockDuration(rec.lockCount);
                    rec.lockUntil = t + dur;
                    rec.lockCount += 1;
                    rec.lastLockAt = t;
                    rec.failures = [];
                    worst = Math.max(worst, dur);
                }
                await this.store.set(key, rec);
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
