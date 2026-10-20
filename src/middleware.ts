import { NextRequest, NextResponse } from "next/server";
import { decideCashRoute } from "@/lib/cash-host";

/**
 * Host-based routing for the cash.* subdomain (T-ML-002).
 *
 * cash.hongjixuan-market-ledger.com 進來的請求會被 rewrite 到 /cash/* path，
 * 讓員工現金清點 PWA 跟主站共用同一個 Next.js app 但獨立路由樹。
 *
 * Apex domain (hongjixuan-market-ledger.com) 走原本的 /* routes，不影響。
 */

export function middleware(req: NextRequest) {
    const host = req.headers.get("host");
    const url = req.nextUrl;

    const decision = decideCashRoute(host, url.pathname);
    if (decision.action === "rewrite") {
        const rewritten = url.clone();
        rewritten.pathname = decision.pathname;
        return NextResponse.rewrite(rewritten);
    }

    return NextResponse.next();
}

export const config = {
    // 不攔 _next 內部資源、static files、PWA manifest、icons
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|api/pos-import|cash-manifest.json|apple-touch-icon.png|icon-192.png|icon-512.png|manifest.json|.*\\.svg).*)",
    ],
};
