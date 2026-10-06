import { requireCashAdmin } from "@/lib/cash-auth";
import prisma from "@/lib/prisma";
import AdminSubNav from "@/components/cash/AdminSubNav";
import { CARD } from "@/components/cash/ui";
import LocationFilter from "@/components/cash/LocationFilter";
import { formatMonthDayWeekday, formatNumber, resolveLocationFilter } from "@/lib/cash-ui";
import { NEUTRAL_BAR_COLOR, averageLabel, buildTrend } from "@/lib/cash-stats";
import { buildStatsWhere } from "@/lib/cash-queries";
import { cn } from "@/lib/utils";
import StatsClient from "./StatsClient";

type ExpenseRow = { item: string; note?: string; amount: number };

const WINDOW_DAYS = 90;

export default async function CashStatsPage(props: { searchParams: Promise<{ loc?: string }> }) {
    const user = await requireCashAdmin();
    const sp = await props.searchParams;

    // 全部攤位（含已停用）：決定圖上每個攤位的固定顏色，也用來把 locationId 轉成名稱
    const allLocations = await prisma.location.findMany({
        where: { tenantId: user.tenantId },
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isActive: true },
    });
    const activeLocations = allLocations.filter((l) => l.isActive);
    const locationName = new Map(allLocations.map((l) => [l.id, l.name]));
    // 攤位篩選（?loc=）：必須是啟用中的攤位，否則視為全部
    const locationId = resolveLocationFilter(sp.loc, activeLocations);

    // 近 90 天的 CashCount（可選：只看某個攤位）
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);

    const rows = await prisma.cashCount.findMany({
        where: buildStatsWhere({ tenantId: user.tenantId, since, locationId }),
        orderBy: { date: "asc" },
        select: {
            id: true,
            date: true,
            locationId: true,
            totalSales: true,
            salesTotal: true,
            expensesTotal: true,
            cashBoxTotal: true,
            reserveTotal: true,
            expensesJson: true,
        },
    });

    // 每日趨勢：兩個攤位同一天各一筆，轉成「每個攤位一條線」
    const { series, trend } = buildTrend(rows, allLocations);

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

    // KPI（算法與重設計前完全相同）
    const totalSum = rows.reduce((acc, r) => acc + r.totalSales, 0);
    const avgPerDay = rows.length > 0 ? Math.round(totalSum / rows.length) : 0;
    let maxRow: (typeof rows)[number] | null = null;
    for (const r of rows) {
        if (r.totalSales > (maxRow?.totalSales ?? 0)) maxRow = r;
    }

    const kpis: { label: string; value: string; sub?: string[] }[] = [
        { label: "總營業額（元）", value: formatNumber(totalSum) },
        { label: `${averageLabel(locationId !== undefined, allLocations.length)}（元）`, value: formatNumber(avgPerDay) },
        { label: "清點筆數", value: `${rows.length} 筆` },
        {
            label: "最高單日（元）",
            value: maxRow ? formatNumber(maxRow.totalSales) : "—",
            sub: maxRow
                ? [formatMonthDayWeekday(maxRow.date.toISOString().slice(0, 10)), locationName.get(maxRow.locationId) ?? ""].filter(Boolean)
                : undefined,
        },
    ];

    return (
        <div className="space-y-4 px-4 pb-4 pt-4 md:pt-6">
            <AdminSubNav />

            <header>
                <h1 className="text-2xl font-bold text-stone-900">清點分析</h1>
                <p className="mt-0.5 text-[15px] text-stone-600">
                    近 {WINDOW_DAYS} 天，{locationId ? locationName.get(locationId) : "全部攤位"}
                </p>
            </header>

            <LocationFilter basePath="/cash/stats" params={{}} locations={activeLocations} selectedId={locationId} />

            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {kpis.map((k) => (
                    <div key={k.label} className={cn(CARD, "p-3.5")}>
                        <dt className="text-[15px] text-stone-600">{k.label}</dt>
                        <dd className="mt-1 text-2xl font-extrabold leading-tight text-stone-900">{k.value}</dd>
                        {k.sub ? (
                            <dd className="mt-0.5 text-[13px] leading-snug text-stone-600">
                                {k.sub.map((line) => (
                                    <span key={line} className="block">{line}</span>
                                ))}
                            </dd>
                        ) : null}
                    </div>
                ))}
            </dl>

            <StatsClient
                series={series}
                trend={trend}
                expenseBreakdown={expenseBreakdown}
                barColor={series.length === 1 ? series[0].color : NEUTRAL_BAR_COLOR}
                windowDays={WINDOW_DAYS}
            />
        </div>
    );
}
