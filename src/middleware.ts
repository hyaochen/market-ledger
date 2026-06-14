import { NextRequest, NextResponse } from "next/server";

/**
 * Host-based routing for the cash.* subdomain (T-ML-002).
 *
 * cash.hongjixuan-market-ledger.com 進來的請求會被 rewrite 到 /cash/* path，
 * 讓員工現金清點 PWA 跟主站共用同一個 Next.js app 但獨立路由樹。
 *
 * Apex domain (hongjixuan-market-ledger.com) 走原本的 /* routes，不影響。
 */

const CASH_HOST_PATTERNS = [
    "cash.hongjixuan-market-ledger.com",
    // 開發 / preview 也支援（用 X-Forwarded-Host 或本機 hosts 條目）
    "cash.localhost",
    "cash.local",
];

function isCashHost(host: string | null): boolean {
    if (!host) return false;
    const lower = host.toLowerCase().split(":")[0];
    return CASH_HOST_PATTERNS.includes(lower);
}

export function middleware(req: NextRequest) {
    const host = req.headers.get("host");
    const url = req.nextUrl;

    if (isCashHost(host)) {
        // 已經是 /cash/* 不重複 rewrite
        if (url.pathname.startsWith("/cash")) {
            return NextResponse.next();
        }
        const rewritten = url.clone();
        rewritten.pathname = `/cash${url.pathname === "/" ? "" : url.pathname}`;
        return NextResponse.rewrite(rewritten);
    }

    return NextResponse.next();
}

export const config = {
    // 不攔 _next 內部資源、static files、PWA manifest、icons
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|cash-manifest.json|apple-touch-icon.png|icon-192.png|icon-512.png|manifest.json|.*\\.svg).*)",
    ],
};
