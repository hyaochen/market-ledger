// 登入失敗節流：5 次失敗 / 15 分鐘 -> 鎖 15 分鐘，重複鎖定指數退避（telegram id 上限 24 小時，
// 帳號名稱上限 1 小時）。
//
// 同時以「Telegram user id」與「嘗試的帳號名稱」兩把 key 計數：
//   - 只鎖 telegram id：攻擊者開多個 Telegram 帳號就繞過去
//   - 只鎖帳號名稱：攻擊者可故意鎖死 mom（repo 是 public，帳號名稱人盡皆知），所以
//     帳號名稱的門檻放寬（MAX_USERNAME_FAILURES）、退避上限壓在 1 小時，telegram id 維持嚴格；
//     兩把 key 任一被鎖都擋，但鎖定只影響「新登入」，已存在的 session 不受影響
//   - 已知裝置：某個 telegram id 曾成功登入過某帳號名稱（記在 SystemConfig tg_known_<id>），
//     就算只有「帳號名稱層」被別人灌爆鎖住，這個 telegram id 仍可放行去驗密碼。
//     telegram id 層的鎖定照常優先，所以它自己連續打錯 5 次一樣會被鎖。
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
// 帳號名稱層的退避上限：被陌生人灌失敗而鎖住的最長時間（telegram id 層仍是 MAX_LOCK_MS）
export const MAX_USERNAME_LOCK_MS = 60 * 60 * 1000;
// 已知裝置清單：每個 telegram id 最多記幾個帳號名稱、多久沒更新才清
export const MAX_KNOWN_USERNAMES = 5;
export const KNOWN_STALE_MS = 400 * 24 * 60 * 60 * 1000;
// 距離上次鎖定超過這麼久，退避等級歸零
export const LOCK_MEMORY_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'login_throttle_';
const KNOWN_PREFIX = 'tg_known_';

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

/** 已知裝置清單的儲存層（值是小寫帳號名稱陣列，最近成功的排最前）。 */
export interface KnownStore {
    get(telegramId: number | string): Promise<string[]>;
    set(telegramId: number | string, usernames: string[]): Promise<void>;
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

export function knownKey(telegramId: number | string): string {
    return `${KNOWN_PREFIX}${telegramId}`;
}

export function normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
}

export const prismaKnownStore: KnownStore = {
    async get(telegramId) {
        const row = await prisma.systemConfig.findFirst({ where: { key: knownKey(telegramId), tenantId: null } });
        if (!row) return [];
        try {
            const v = JSON.parse(row.value);
            return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        } catch { return []; }
    },
    async set(telegramId, usernames) {
        const key = knownKey(telegramId);
        const value = JSON.stringify(usernames);
        const existing = await prisma.systemConfig.findFirst({ where: { key, tenantId: null } });
        if (existing) await prisma.systemConfig.update({ where: { id: existing.id }, data: { value } });
        else await prisma.systemConfig.create({ data: { key, value, tenantId: null } });
    },
};

/**
 * 清掉過期紀錄（bot 啟動時與之後每 6 小時各一次）：
 *   - 節流計數：兩天沒動過（鎖定上限 24 小時，兩天前的紀錄必然已失效）
 *   - 已知裝置清單：400 天沒更新（每次成功登入都會更新，所以只清真正不再使用的）
 */
export async function pruneStaleThrottleRows(now: number = Date.now()): Promise<number> {
    const res = await prisma.systemConfig.deleteMany({
        where: { key: { startsWith: KEY_PREFIX }, tenantId: null, updatedAt: { lt: new Date(now - STALE_MS) } },
    });
    const known = await prisma.systemConfig.deleteMany({
        where: { key: { startsWith: KNOWN_PREFIX }, tenantId: null, updatedAt: { lt: new Date(now - KNOWN_STALE_MS) } },
    });
    return res.count + known.count;
}

export type LockStatus = { locked: false } | { locked: true; retryAfterMs: number };

function lockDuration(lockCount: number, maxLockMs: number = MAX_LOCK_MS): number {
    // lockCount 為「這次之前」的鎖定次數：0 -> 15 分、1 -> 30 分、2 -> 60 分 ...
    return Math.min(BASE_LOCK_MS * 2 ** lockCount, maxLockMs);
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
        private known: KnownStore = prismaKnownStore,
    ) {}

    // 讀取不到（DB 出錯）一律放行：節流是加強防線，不能因為它壞掉讓媽媽登不進去
    async check(keys: ThrottleKeys): Promise<LockStatus> {
        const t = this.now();
        const remaining = async (key: string): Promise<number> => {
            try {
                const rec = await this.store.get(key);
                return rec && rec.lockUntil > t ? rec.lockUntil - t : 0;
            } catch { return 0; /* fail-open */ }
        };
        const tgLeft = await remaining(telegramKey(keys.telegramId));
        const userLeft = await remaining(usernameKey(keys.username));

        // telegram id 層的鎖定永遠優先（兩層的最大值）
        if (tgLeft > 0) return { locked: true, retryAfterMs: Math.max(tgLeft, userLeft) };
        if (userLeft > 0) {
            // 只有帳號名稱層被鎖：這個 telegram id 曾成功登入過該帳號就放行去驗密碼，
            // 別人灌出來的失敗計數不能把本人鎖在門外
            let isKnown = false;
            try { isKnown = (await this.known.get(keys.telegramId)).includes(normalizeUsername(keys.username)); } catch { /* 當成未知 */ }
            if (!isKnown) return { locked: true, retryAfterMs: userLeft };
        }
        return { locked: false };
    }

    // 記一次失敗；回傳這次是否剛好觸發鎖定（兩把 key 任一觸發即算）
    async recordFailure(keys: ThrottleKeys): Promise<LockStatus> {
        const t = this.now();
        let worst = 0;
        const limits: Array<[string, number, number]> = [
            [telegramKey(keys.telegramId), MAX_FAILURES, MAX_LOCK_MS],
            [usernameKey(keys.username), MAX_USERNAME_FAILURES, MAX_USERNAME_LOCK_MS],
        ];
        for (const [key, max, maxLock] of limits) {
            try {
                await withKeyLock(key, async () => {
                    const rec = (await this.store.get(key)) ?? { failures: [], lockUntil: 0, lockCount: 0, lastLockAt: 0 };
                    if (rec.lastLockAt && t - rec.lastLockAt > LOCK_MEMORY_MS) rec.lockCount = 0;
                    rec.failures = rec.failures.filter(ts => t - ts < WINDOW_MS);
                    rec.failures.push(t);
                    if (rec.failures.length >= max) {
                        const dur = lockDuration(rec.lockCount, maxLock);
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

    // 真正建立 session 之後才呼叫（密碼對但唯讀帳號被拒絕不算）：
    // 清掉「這個 telegram id」與「這次登入的帳號名稱」的失敗計數與退避等級，
    // 並把帳號名稱記進這個 telegram id 的已知清單。不碰任何其他 key。
    async recordSuccess(keys: ThrottleKeys): Promise<void> {
        for (const key of [telegramKey(keys.telegramId), usernameKey(keys.username)]) {
            try { await this.store.del(key); } catch { /* ignore */ }
        }
        try {
            const name = normalizeUsername(keys.username);
            const list = (await this.known.get(keys.telegramId)).filter(u => u !== name);
            await this.known.set(keys.telegramId, [name, ...list].slice(0, MAX_KNOWN_USERNAMES));
        } catch { /* ignore */ }
    }
}

export const loginThrottle = new LoginThrottle();
