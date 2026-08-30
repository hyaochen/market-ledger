// 共用 API route helper（非 route，檔名底線開頭 Next.js 不會當成 endpoint）。
// 所有 analytics API 都要求先登入才能查，回傳目前使用者的 tenantId，
// 未登入 / super admin 沒有 tenant context 一律 401 —— 絕不讓查詢在沒有 tenantId
// 的狀況下跑（那樣會漏資料或誤查到其他租戶）。

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function requireTenant(): Promise<{ tenantId: string } | NextResponse> {
    const user = await getCurrentUser();
    if (!user || !user.tenantId) {
        return NextResponse.json({ error: "請先登入" }, { status: 401 });
    }
    return { tenantId: user.tenantId };
}

export function isErrorResponse(value: unknown): value is NextResponse {
    return value instanceof NextResponse;
}
