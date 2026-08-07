// GET /api/analytics/search/items?q=品項關鍵字&itemId=&from=YYYY-MM-DD&to=YYYY-MM-DD
// 需求 #1：品項關鍵字搜尋（可模糊）+ 日期範圍 → 回該品項所有進貨（含單價/廠商/單位換算）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../../_lib";
import { searchItemPurchases } from "@/lib/analytics/itemSearch";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await searchItemPurchases({
            tenantId: auth.tenantId,
            query: url.searchParams.get("q") ?? undefined,
            itemId: url.searchParams.get("itemId") ?? undefined,
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/search/items error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
