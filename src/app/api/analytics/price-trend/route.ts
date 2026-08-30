// GET /api/analytics/price-trend?q=品項關鍵字&itemId=&from=&to=
// 需求 #4：品項價格趨勢 — 月均單價變化（抓漲價）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../_lib";
import { getItemPriceTrend } from "@/lib/analytics/priceTrend";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await getItemPriceTrend({
            tenantId: auth.tenantId,
            query: url.searchParams.get("q") ?? undefined,
            itemId: url.searchParams.get("itemId") ?? undefined,
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/price-trend error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
