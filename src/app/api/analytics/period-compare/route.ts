// GET /api/analytics/period-compare?month=YYYY-MM
// 需求 #6：月環比（MoM）/ 去年同期（YoY）— 營收、支出、各分類
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../_lib";
import { getPeriodComparison } from "@/lib/analytics/periodCompare";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await getPeriodComparison({
            tenantId: auth.tenantId,
            month: url.searchParams.get("month") ?? undefined,
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/period-compare error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
