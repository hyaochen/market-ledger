// GET /api/analytics/stall-profit?from=&to=&minConfidence=0.75
// 需求 #5：攤位損益對比（屏東 vs 潮州）—— 進貨無法分攤位，回傳裡有明確 caveat 說明
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../_lib";
import { getStallProfitComparison } from "@/lib/analytics/stallProfit";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    const minConfidenceParam = url.searchParams.get("minConfidence");
    const minConfidence = minConfidenceParam ? Number.parseFloat(minConfidenceParam) : undefined;

    try {
        const result = await getStallProfitComparison({
            tenantId: auth.tenantId,
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
            minConfidence: Number.isFinite(minConfidence) ? minConfidence : undefined,
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/stall-profit error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
