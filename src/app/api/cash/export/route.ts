import { NextResponse } from "next/server";
import { listCashCounts } from "@/app/actions/cash";
import { getCurrentUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL } from "@/lib/cash-constants";

export async function GET(req: Request) {
    // 未登入直接回 401（requireCashAuth 的 redirect() 在 route handler 裡會被 catch 吞成 500）
    const me = await getCurrentUser();
    if (!me || !me.tenantId) {
        return NextResponse.json({ error: "請先登入" }, { status: 401 });
    }
    try {
        const url = new URL(req.url);
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        // T-ML-034：管理者在歷史頁篩選了某個攤位時，匯出也只匯出那個攤位（沒帶就是全部，跟以前一樣）
        const locationId = url.searchParams.get("loc") || undefined;
        const rows = await listCashCounts({ from, to, locationId });

        const header = [
            "日期", "攤位", "清點人",
            "錢盒合計", "備用金合計", "營業現金合計", "支出合計", "今日營業額",
            "錢盒差額", "備用金差額", "備註", "建立時間",
        ];
        const lines: unknown[][] = [header];
        for (const r of rows) {
            const dateStr = r.date.toISOString().slice(0, 10);
            const createdAt = r.createdAt.toISOString().slice(0, 19).replace("T", " ");
            lines.push([
                dateStr,
                r.location.name,
                r.attendant.realName || r.attendant.username,
                r.cashBoxTotal,
                r.reserveTotal,
                r.salesTotal,
                r.expensesTotal,
                r.totalSales,
                r.cashBoxTotal - CASH_BOX_TARGET_TOTAL,
                r.reserveTotal - RESERVE_TARGET_TOTAL,
                r.note ?? "",
                createdAt,
            ]);
        }
        const csv = "﻿" + toCsv(lines, "\n"); // BOM for Excel UTF-8 detection
        const safe = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
        const filename = `cash-counts_${safe(from) ?? "all"}_${safe(to) ?? "now"}.csv`;
        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    } catch (e) {
        const digest = (e as { digest?: unknown } | null)?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
            return NextResponse.json({ error: "請先登入" }, { status: 401 });
        }
        console.error("cash export error", e);
        return NextResponse.json({ error: "匯出失敗" }, { status: 500 });
    }
}
