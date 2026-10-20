// 登入失敗次數限制（in-memory，單一 Node process）。
// 兩層：
//   1. IP + 帳號：連續 5 次就鎖 15 分鐘 —— 擋同一來源猜同一帳號
//   2. 帳號本身：寬鬆得多（50 次），避免攻擊者換 IP 猜密碼，但不會因為一個 IP 就把老闆鎖在門外
// 「先預約再驗證」：reserveLoginAttempt 在任何 await 之前同步把次數 +1，
// 所以同時湧入的一波請求不可能都看到 count = 0。登入成功才 releaseLoginAttempt 還回去。

export const MAX_ATTEMPTS_PER_IP_USER = 5;
export const MAX_ATTEMPTS_PER_USER = 50;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_TRACKED_KEYS = 10000;

type Entry = { count: number; last: number; lockLogged: boolean };

const ipUserMap = new Map<string, Entry>();
const userMap = new Map<string, Entry>();

export type ReserveResult =
    | { allowed: true }
    | { allowed: false; retryMinutes: number; scope: "ip-user" | "user"; shouldLog: boolean };

function normUser(username: string) {
    return username.trim().toLowerCase().slice(0, 64);
}

function fresh(map: Map<string, Entry>, key: string, now: number): Entry | undefined {
    const e = map.get(key);
    if (!e) return undefined;
    if (now - e.last >= LOCKOUT_MS) {
        map.delete(key);
        return undefined;
    }
    return e;
}

function prune(map: Map<string, Entry>, now: number) {
    if (map.size < MAX_TRACKED_KEYS) return;
    for (const [k, e] of map) {
        if (now - e.last >= LOCKOUT_MS) map.delete(k);
    }
    // 仍超過上限：依插入順序（最舊在前）淘汰
    for (const k of map.keys()) {
        if (map.size < MAX_TRACKED_KEYS) break;
        map.delete(k);
    }
}

function bump(map: Map<string, Entry>, key: string, now: number) {
    const e = fresh(map, key, now) ?? { count: 0, last: now, lockLogged: false };
    e.count += 1;
    e.last = now;
    map.delete(key); // 重新插入 → 移到最後，淘汰時最後才輪到活躍的 key
    map.set(key, e);
}

export function reserveLoginAttempt(ip: string, username: string, now: number = Date.now()): ReserveResult {
    const u = normUser(username);
    const ipUserKey = `${ip}|${u}`;
    const a = fresh(ipUserMap, ipUserKey, now);
    const b = fresh(userMap, u, now);

    const lockedA = !!a && a.count >= MAX_ATTEMPTS_PER_IP_USER;
    const lockedB = !!b && b.count >= MAX_ATTEMPTS_PER_USER;
    if (lockedA || lockedB) {
        const e = (lockedA ? a : b)!;
        const retryMinutes = Math.max(1, Math.ceil((LOCKOUT_MS - (now - e.last)) / 60000));
        const shouldLog = !e.lockLogged; // 每個鎖定視窗只記一筆，避免攻擊時把 OperationLog 灌爆
        e.lockLogged = true;
        return { allowed: false, retryMinutes, scope: lockedA ? "ip-user" : "user", shouldLog };
    }

    prune(ipUserMap, now);
    prune(userMap, now);
    bump(ipUserMap, ipUserKey, now);
    bump(userMap, u, now);
    return { allowed: true };
}

/** 登入成功：還回預約。IP+帳號直接清掉；帳號層只退回這一次，保留別人猜測的累計。 */
export function releaseLoginAttempt(ip: string, username: string) {
    const u = normUser(username);
    ipUserMap.delete(`${ip}|${u}`);
    const b = userMap.get(u);
    if (b) {
        b.count = Math.max(0, b.count - 1);
        if (b.count === 0) userMap.delete(u);
    }
}

export function _resetLoginLimiterForTest() {
    ipUserMap.clear();
    userMap.clear();
}

export function _limiterSizesForTest() {
    return { ipUser: ipUserMap.size, user: userMap.size };
}

/** 從 request headers 取得 client IP：Cloudflare 的 cf-connecting-ip → x-forwarded-for 第一段 → unknown。 */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string {
    const cf = h.get("cf-connecting-ip")?.trim();
    if (cf) return cf.slice(0, 64);
    const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff.slice(0, 64);
    return "unknown";
}
