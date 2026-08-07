// GET /api/analytics/search/notes?q=關鍵字&from=&to=&source=entry|revenue|both
// 需求 #3：備註全文搜尋 — 跨 Entry.note 與 Revenue.note
import { NextResponse } from "next/server";
import { requireTenant, isErrorResponse } from "../../_lib";
import { searchNotes } from "@/lib/analytics/noteSearch";

export async function GET(req: Request) {
    const auth = await requireTenant();
    if (isErrorResponse(auth)) return auth;

    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    if (!q || !q.trim()) {
        return NextResponse.json({ error: "請提供搜尋關鍵字 q" }, { status: 400 });
    }
    const sourceParam = url.searchParams.get("source");
    const source = sourceParam === "entry" || sourceParam === "revenue" ? sourceParam : "both";

    try {
        const result = await searchNotes({
            tenantId: auth.tenantId,
            query: q,
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
            source,
        });
        return NextResponse.json(result);
    } catch (e) {
        console.error("analytics/search/notes error", e);
        return NextResponse.json({ error: "查詢失敗" }, { status: 500 });
    }
}
