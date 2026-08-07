// GET /api/analytics/classify/purchase?name=品項名稱
// 需求 #8：進貨自動歸類（對應現有 Category：肉類/菜類/其他）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../../_lib";
import { classifyPurchaseCategory } from "@/lib/analytics/classifyPurchase";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (!name || !name.trim()) {
        return NextResponse.json({ error: "請提供品項名稱 name" }, { status: 400 });
    }

    try {
        const result = await classifyPurchaseCategory(auth.tenantId, name);
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/classify/purchase error", e);
        return NextResponse.json({ error: "分類失敗" }, { status: 500 });
    }
}
