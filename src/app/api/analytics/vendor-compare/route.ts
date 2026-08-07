// GET /api/analytics/vendor-compare?q=品項關鍵字&itemId=&from=&to=
// 需求 #2：廠商比價 — 同品項跨廠商單價對照（已換算到元/kg 同一基準）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../_lib";
import { compareVendorPrices } from "@/lib/analytics/vendorCompare";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await compareVendorPrices({
            tenantId: auth.tenantId,
            query: url.searchParams.get("q") ?? undefined,
            itemId: url.searchParams.get("itemId") ?? undefined,
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/vendor-compare error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
