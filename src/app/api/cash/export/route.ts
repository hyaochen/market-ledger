import { NextResponse } from "next/server";
import { listCashCounts } from "@/app/actions/cash";

function csvEscape(v: unknown): string {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const from = url.searchParams.get("from") || undefined;
        const to = url.searchParams.get("to") || undefined;
        const rows = await listCashCounts({ from, to });

        const header = [
            "日期", "攤位", "清點人",
            "錢盒合計", "備用金合計", "營業現金合計", "支出合計", "今日營業額",
            "錢盒差額", "備用金差額", "備註", "建立時間",
        ];
        const lines = [header.join(",")];
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
                r.cashBoxTotal - 6580,
                r.reserveTotal - 7600,
                r.note ?? "",
                createdAt,
            ].map(csvEscape).join(","));
        }
        const csv = "﻿" + lines.join("\n"); // BOM for Excel UTF-8 detection
        const filename = `cash-counts_${from ?? "all"}_${to ?? "now"}.csv`;
        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    } catch (e) {
        console.error("cash export error", e);
        return NextResponse.json({ error: "匯出失敗" }, { status: 500 });
    }
}
