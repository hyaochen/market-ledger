import { requireCashAdmin } from "@/lib/cash-auth";
import prisma from "@/lib/prisma";
import StatsClient from "./StatsClient";

type ExpenseRow = { item: string; note?: string; amount: number };

export default async function CashStatsPage() {
    const user = await requireCashAdmin();

    // 近 90 天的 CashCount
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const rows = await prisma.cashCount.findMany({
        where: { tenantId: user.tenantId, date: { gte: since } },
        orderBy: { date: "asc" },
        select: {
            id: true,
            date: true,
            totalSales: true,
            salesTotal: true,
            expensesTotal: true,
            cashBoxTotal: true,
            reserveTotal: true,
            expensesJson: true,
        },
    });

    // 每日趨勢
    const trend = rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        totalSales: r.totalSales,
        sales: r.salesTotal,
        expenses: r.expensesTotal,
    }));

    // 支出分類加總
    const expenseAgg: Record<string, number> = {};
    for (const r of rows) {
        try {
            const items = JSON.parse(r.expensesJson) as ExpenseRow[];
            if (Array.isArray(items)) {
                for (const e of items) {
                    const key = (e.item || "其他").trim() || "其他";
                    expenseAgg[key] = (expenseAgg[key] ?? 0) + (Number(e.amount) || 0);
                }
            }
        } catch { /* skip malformed */ }
    }
    const expenseBreakdown = Object.entries(expenseAgg)
        .map(([item, amount]) => ({ item, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 12);

    // KPI
    const totalSum = rows.reduce((acc, r) => acc + r.totalSales, 0);
    const avgPerDay = rows.length > 0 ? Math.round(totalSum / rows.length) : 0;
    const maxDay = rows.reduce((m, r) => (r.totalSales > m.totalSales ? r : m), { date: new Date(), totalSales: 0 } as { date: Date; totalSales: number });

    return (
        <div className="p-4 space-y-4">
            <h1 className="text-lg font-bold">📊 清點分析（近 90 天）</h1>
            <div className="grid grid-cols-3 gap-2">
                <Kpi label="總營業額" value={`NT$ ${totalSum.toLocaleString()}`} />
                <Kpi label="日均" value={`NT$ ${avgPerDay.toLocaleString()}`} />
                <Kpi label="筆數" value={String(rows.length)} />
            </div>
            <StatsClient trend={trend} expenseBreakdown={expenseBreakdown} />
            {maxDay.totalSales > 0 && (
                <p className="text-xs text-zinc-500">
                    最高單日：{maxDay.date.toISOString().slice(0, 10)} NT$ {maxDay.totalSales.toLocaleString()}
                </p>
            )}
        </div>
    );
}

function Kpi({ label, value }: { label: string; value: string }) {
    return (
        <div className="border border-amber-200 bg-white rounded-md p-2.5 text-center">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="font-bold text-amber-700">{value}</div>
        </div>
    );
}
