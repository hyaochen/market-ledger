// GET /api/analytics/anomalies?from=&to=
// 需求 #7：異常偵測（6 類彙總：金額離群/單價離群/日期異常/同人多寫法/攤位備註錯字/固定支出缺漏）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../_lib";
import { detectAllAnomalies } from "@/lib/analytics/anomalies";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await detectAllAnomalies(
            auth.tenantId,
            url.searchParams.get("from"),
            url.searchParams.get("to")
        );
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/anomalies error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
