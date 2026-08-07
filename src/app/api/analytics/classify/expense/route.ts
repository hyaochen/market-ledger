// GET /api/analytics/classify/expense?text=支出描述文字
// 需求 #9：支出自動分類（文字 → expenseType）
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../../_lib";
import { classifyExpenseType } from "@/lib/analytics/classifyExpense";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    const text = url.searchParams.get("text");
    if (!text || !text.trim()) {
        return NextResponse.json({ error: "請提供支出描述 text" }, { status: 400 });
    }

    try {
        const result = await classifyExpenseType(auth.tenantId, text);
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/classify/expense error", e);
        return NextResponse.json({ error: "分類失敗" }, { status: 500 });
    }
}
