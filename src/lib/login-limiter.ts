// 登入失敗次數限制（in-memory，單一 Node process）。
// 三層：
//   1. IP + 帳號：連續 5 次就鎖 15 分鐘 —— 擋同一來源猜同一帳號
//   2. IP 本身：30 次 —— 擋同一來源輪流猜所有帳號（password spraying），也限制每次失敗
//      都要跑一次 bcrypt 的 CPU 消耗
//   3. 帳號本身：寬鬆得多（50 次），避免攻擊者換 IP 猜密碼，但不會因為一個 IP 就把老闆鎖在門外
// 「先預約再驗證」：reserveLoginAttempt 在任何 await 之前同步把次數 +1，
// 所以同時湧入的一波請求不可能都看到 count = 0。登入成功才 releaseLoginAttempt 還回去。

export const MAX_ATTEMPTS_PER_IP_USER = 5;
export const MAX_ATTEMPTS_PER_IP = 30;
export const MAX_ATTEMPTS_PER_USER = 50;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const MAX_TRACKED_KEYS = 10000;

type Entry = { count: number; last: number; lockLogged: boolean };

const ipUserMap = new Map<string, Entry>();
const ipMap = new Map<string, Entry>();
const userMap = new Map<string, Entry>();

export type ReserveResult =
    | { allowed: true }
    | { allowed: false; retryMinutes: number; scope: "ip-user" | "ip" | "user"; shouldLog: boolean };

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
    const c = fresh(ipMap, ip, now);

    const lockedA = !!a && a.count >= MAX_ATTEMPTS_PER_IP_USER;
    const lockedC = !!c && c.count >= MAX_ATTEMPTS_PER_IP;
    const lockedB = !!b && b.count >= MAX_ATTEMPTS_PER_USER;
    if (lockedA || lockedC || lockedB) {
        const e = (lockedA ? a : lockedC ? c : b)!;
        const retryMinutes = Math.max(1, Math.ceil((LOCKOUT_MS - (now - e.last)) / 60000));
        const shouldLog = !e.lockLogged; // 每個鎖定視窗只記一筆，避免攻擊時把 OperationLog 灌爆
        e.lockLogged = true;
        return { allowed: false, retryMinutes, scope: lockedA ? "ip-user" : lockedC ? "ip" : "user", shouldLog };
    }

    prune(ipUserMap, now);
    prune(ipMap, now);
    prune(userMap, now);
    bump(ipUserMap, ipUserKey, now);
    bump(ipMap, ip, now);
    bump(userMap, u, now);
    return { allowed: true };
}

/**
 * 已知裝置專用：只檢查並累計「IP+帳號」與「IP」兩層，完全不看也不累計帳號層。
 * 呼叫前提：同一次登入已先呼叫過 reserveLoginAttempt 且因 scope = "user" 被擋（那次呼叫沒有累計任何東西）。
 * 同步執行（內部沒有 await），所以 5 次 / 30 次的上限對偷到 cookie 的人一樣有效。
 */
export function reserveTrustedAttempt(ip: string, username: string, now: number = Date.now()): ReserveResult {
    const u = normUser(username);
    const ipUserKey = `${ip}|${u}`;
    const a = fresh(ipUserMap, ipUserKey, now);
    const c = fresh(ipMap, ip, now);
    const lockedA = !!a && a.count >= MAX_ATTEMPTS_PER_IP_USER;
    const lockedC = !!c && c.count >= MAX_ATTEMPTS_PER_IP;
    if (lockedA || lockedC) {
        const e = (lockedA ? a : c)!;
        const retryMinutes = Math.max(1, Math.ceil((LOCKOUT_MS - (now - e.last)) / 60000));
        const shouldLog = !e.lockLogged;
        e.lockLogged = true;
        return { allowed: false, retryMinutes, scope: lockedA ? "ip-user" : "ip", shouldLog };
    }
    prune(ipUserMap, now);
    prune(ipMap, now);
    bump(ipUserMap, ipUserKey, now);
    bump(ipMap, ip, now);
    return { allowed: true };
}

/**
 * 登入成功：還回預約。IP+帳號直接清掉；帳號層只退回這一次，保留別人猜測的累計。
 * opts.skipUser：已知裝置路徑沒有累計帳號層，所以不能退。
 */
export function releaseLoginAttempt(ip: string, username: string, opts?: { skipUser?: boolean }) {
    const u = normUser(username);
    ipUserMap.delete(`${ip}|${u}`);
    const targets = opts?.skipUser
        ? ([[ipMap, ip]] as const)
        : ([[userMap, u], [ipMap, ip]] as const);
    for (const [map, key] of targets) {
        const e = map.get(key);
        if (e) {
            e.count = Math.max(0, e.count - 1);
            if (e.count === 0) map.delete(key);
        }
    }
}

export function _resetLoginLimiterForTest() {
    ipUserMap.clear();
    ipMap.clear();
    userMap.clear();
}

export function _limiterSizesForTest() {
    return { ipUser: ipUserMap.size, ip: ipMap.size, user: userMap.size };
}

function parseIpv4(s: string): number[] | null {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
    const parts = s.split(".").map(Number);
    return parts.every((n) => n <= 255) ? parts : null;
}

/** 把 IPv6 字串展開成 8 組 16-bit 數字；無法解析回 null。 */
function parseIpv6(input: string): number[] | null {
    let s = input.toLowerCase();
    const zone = s.indexOf("%");
    if (zone >= 0) s = s.slice(0, zone);
    if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
    if (!s.includes(":")) return null;

    // 尾端內嵌 IPv4（::ffff:1.2.3.4）→ 換成兩組 hex
    const lastColon = s.lastIndexOf(":");
    const tail = s.slice(lastColon + 1);
    if (tail.includes(".")) {
        const v4 = parseIpv4(tail);
        if (!v4) return null;
        const hi = ((v4[0] << 8) | v4[1]).toString(16);
        const lo = ((v4[2] << 8) | v4[3]).toString(16);
        s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
    }

    const halves = s.split("::");
    if (halves.length > 2) return null;
    const toGroups = (part: string): string[] | null => {
        if (part === "") return [];
        const g = part.split(":");
        return g.every((x) => /^[0-9a-f]{1,4}$/.test(x)) ? g : null;
    };
    const head = toGroups(halves[0]);
    if (!head) return null;
    let groups: string[];
    if (halves.length === 2) {
        const rest = toGroups(halves[1]);
        if (!rest) return null;
        const fill = 8 - head.length - rest.length;
        if (fill < 1) return null; // "::" 至少代表一組零
        groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
    } else {
        groups = head;
    }
    if (groups.length !== 8) return null;
    return groups.map((x) => parseInt(x, 16));
}

/**
 * 把 client IP 轉成節流用的 key：
 *   - IPv4：原樣
 *   - IPv4-mapped IPv6（::ffff:a.b.c.d）：當 IPv4
 *   - IPv6：只取前 64 bit（/64），同一個 /64 內換位址仍是同一個來源
 *   - 無法解析：原樣截斷到 64 字元
 * 只用於節流；OperationLog 仍記完整 IP。
 */
export function throttleKeyForIp(raw: string): string {
    const s = raw.trim().slice(0, 64);
    if (parseIpv4(s)) return s;
    const g = parseIpv6(s);
    if (!g) return s;
    const isMapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    if (isMapped) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return `${g.slice(0, 4).map((x) => x.toString(16).padStart(4, "0")).join(":")}::/64`;
}

/** 從 request headers 取得 client IP：Cloudflare 的 cf-connecting-ip → x-forwarded-for 第一段 → unknown。 */
export function clientIpFromHeaders(h: { get(name: string): string | null }): string {
    const cf = h.get("cf-connecting-ip")?.trim();
    if (cf) return cf.slice(0, 64);
    const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (xff) return xff.slice(0, 64);
    return "unknown";
}
