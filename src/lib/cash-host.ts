/**
 * cash.* 子網域的路由決策（純函式，middleware 與單元測試共用）。
 */

export const CASH_HOST_PATTERNS = [
    "cash.hongjixuan-market-ledger.com",
    // 開發 / preview 也支援（用 X-Forwarded-Host 或本機 hosts 條目）
    "cash.localhost",
    "cash.local",
];

export function isCashHost(host: string | null | undefined): boolean {
    if (!host) return false;
    const lower = host.toLowerCase().split(":")[0];
    return CASH_HOST_PATTERNS.includes(lower);
}

export type CashRouteDecision =
    | { action: "next" }
    | { action: "rewrite"; pathname: string };

/**
 * - 不是 cash host：不動
 * - 已經在 /cash 或 /cash/...：不重複 rewrite（注意 /cashfoo 不算）
 * - /api/...：不 rewrite（/api/cash/export 等 API 在 cash host 也要打得到）
 * - 其他：rewrite 到 /cash<path>
 */
export function decideCashRoute(host: string | null | undefined, pathname: string): CashRouteDecision {
    if (!isCashHost(host)) return { action: "next" };
    if (pathname === "/cash" || pathname.startsWith("/cash/")) return { action: "next" };
    if (pathname === "/api" || pathname.startsWith("/api/")) return { action: "next" };
    return { action: "rewrite", pathname: `/cash${pathname === "/" ? "" : pathname}` };
}
