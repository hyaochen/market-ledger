// GET /api/analytics/classify/stall?note=&vendorId=&itemId=&excludeEntryId=
// 需求 #10：攤位自動判斷（推不出來回 unknown + 信心度，不硬猜）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../../_lib";
import { classifyStall } from "@/lib/analytics/classifyStall";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    try {
        const result = await classifyStall({
            tenantId: auth.tenantId,
            note: url.searchParams.get("note"),
            vendorId: url.searchParams.get("vendorId") ?? undefined,
            itemId: url.searchParams.get("itemId") ?? undefined,
            excludeEntryId: url.searchParams.get("excludeEntryId") ?? undefined,
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/classify/stall error", e);
        return NextResponse.json({ error: "分類失敗" }, { status: 500 });
    }
}
