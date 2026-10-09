// GET /api/pos-sync-status
//
// 給「立即同步」按鈕在長時間同步（或連線中斷）時輪詢用：回傳同步服務的 /status。
// 需要登入且屬於真實租戶（demo 租戶不行）；不含任何營業資料。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { ensurePosAccess } from "@/lib/pos-access";
import { describeLastRun, fetchSyncStatus } from "@/lib/pos-sync";

export async function GET() {
    const auth = await ensurePosAccess();
    if (!auth.ok) return NextResponse.json({ ok: false }, { status: 401 });
    const status = await fetchSyncStatus();
    return NextResponse.json({
        ok: true,
        reachable: status !== null,
        running: status?.running ?? false,
        line: describeLastRun(status),
    });
}
