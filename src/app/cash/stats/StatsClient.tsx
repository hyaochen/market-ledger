"use client";

import { useMemo } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    LabelList,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { formatMonthDayWeekday, formatNtd, formatNumber } from "@/lib/cash-ui";
import {
    endLabelsFit,
    formatAxisDate,
    formatAxisMoney,
    truncateLabel,
    type TrendPoint,
    type TrendSeries,
} from "@/lib/cash-stats";
import { CARD } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

type ExpenseRow = { item: string; amount: number };

type Props = {
    series: TrendSeries[];
    trend: TrendPoint[];
    expenseBreakdown: ExpenseRow[];
    /** 支出分類長條的顏色：單一攤位時用該攤位的顏色，全部攤位時用中性色 */
    barColor: string;
    windowDays: number;
};

// 圖表用的墨色與格線：格線一律「比底色深一階」的實線 hairline，不用虛線
const GRID = "#e7e5e4"; // stone-200
const AXIS_LINE = "#d6d3d1"; // stone-300
const AXIS_TEXT = "#57534e"; // stone-600
const INK = "#1c1917"; // stone-900
const SURFACE = "#ffffff";

type TooltipProps = {
    active?: boolean;
    payload?: ReadonlyArray<{ payload?: Record<string, unknown> }>;
};

/**
 * 趨勢圖 tooltip：一個 tooltip 列出該日期所有攤位。
 * 數字是主角（粗體、深色），攤位名稱是次要；用短線段當色鍵，不用色塊。
 * 只有一個攤位時，多列出「現金 ＋ 支出」讓人看到營業額是怎麼來的。
 */
function TrendTooltip({ active, payload, series, trend }: TooltipProps & { series: TrendSeries[]; trend: TrendPoint[] }) {
    if (!active || !payload || payload.length === 0) return null;
    const date = payload[0]?.payload?.date;
    if (typeof date !== "string") return null;
    const point = trend.find((p) => p.date === date);
    if (!point) return null;
    const single = series.length === 1;

    return (
        <div className="min-w-[10rem] rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-lg">
            <p className="text-[13px] font-semibold text-stone-600">{formatMonthDayWeekday(date)}</p>
            <ul className="mt-1.5 space-y-1.5">
                {series.map((s) => {
                    const v = point.values[s.id];
                    return (
                        <li key={s.id} className="flex items-center gap-2">
                            <span aria-hidden="true" className="inline-block h-[3px] w-4 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                            <div className="min-w-0">
                                <p className="text-base font-extrabold leading-tight text-stone-900">
                                    {v ? formatNtd(v.total) : "沒有紀錄"}
                                </p>
                                <p className="text-[13px] leading-tight text-stone-600">
                                    {s.name}
                                    {single && v ? `　現金 ${formatNumber(v.sales)} ＋ 支出 ${formatNumber(v.expenses)}` : ""}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Legend({ series }: { series: TrendSeries[] }) {
    if (series.length < 2) return null;
    return (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5" aria-label="圖例">
            {series.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[15px] font-semibold text-stone-800">
                    <span aria-hidden="true" className="inline-block h-[3px] w-5 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                </li>
            ))}
        </ul>
    );
}

function TableTwin({
    summary,
    head,
    rows,
}: {
    summary: string;
    head: string[];
    rows: (string | number)[][];
}) {
    return (
        <details className="mt-3 border-t border-stone-200 pt-1">
            <summary className="flex min-h-11 cursor-pointer items-center text-base font-bold text-amber-900">{summary}</summary>
            <div className="max-h-80 overflow-auto rounded-xl border border-stone-200">
                <table className="w-full text-[15px]">
                    <thead className="sticky top-0 bg-stone-100 text-[13px] text-stone-700">
                        <tr>
                            {head.map((h, i) => (
                                <th key={h} scope="col" className={cn("px-3 py-2 font-semibold", i === 0 ? "text-left" : "text-right")}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                        {rows.map((r, ri) => (
                            <tr key={ri}>
                                {r.map((cell, ci) => (
                                    <td key={ci} className={cn("px-3 py-2 tabular-nums text-stone-900", ci === 0 ? "text-left font-semibold" : "text-right")}>
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}

function TrendChart({ series, trend, windowDays }: { series: TrendSeries[]; trend: TrendPoint[]; windowDays: number }) {
    const data = useMemo(
        () =>
            trend.map((p) => {
                const flat: Record<string, string | number | undefined> = { date: p.date };
                for (const s of series) flat[s.id] = p.values[s.id]?.total;
                return flat;
            }),
        [trend, series],
    );

    const { lastIndex, lastValue, domainMax } = useMemo(() => {
        const lastIndexMap: Record<string, number> = {};
        const lastValueMap: Record<string, number> = {};
        trend.forEach((p, i) => {
            for (const s of series) {
                const v = p.values[s.id];
                if (v) {
                    lastIndexMap[s.id] = i;
                    lastValueMap[s.id] = v.total;
                }
            }
        });
        const max = Math.max(1, ...trend.flatMap((p) => Object.values(p.values).map((v) => v.total)));
        return { lastIndex: lastIndexMap, lastValue: lastValueMap, domainMax: max };
    }, [trend, series]);

    const multi = series.length > 1;
    const showEndLabels = multi && endLabelsFit(series.map((s) => lastValue[s.id] ?? 0), domainMax);

    const rows = trend.map((p) => {
        if (multi) {
            return [p.date, ...series.map((s) => (p.values[s.id] ? formatNumber(p.values[s.id].total) : "—"))];
        }
        const v = p.values[series[0].id];
        return [p.date, v ? formatNumber(v.total) : "—", v ? formatNumber(v.sales) : "—", v ? formatNumber(v.expenses) : "—"];
    });
    const head = multi ? ["日期", ...series.map((s) => s.name)] : ["日期", "今日營業額", "營業現金", "當天支出"];

    return (
        <section aria-labelledby="trend-title" className={cn(CARD, "p-4")}>
            <h2 id="trend-title" className="text-lg font-bold text-stone-900">每日營業額</h2>
            <p className="mt-0.5 text-[15px] text-stone-600">
                近 {windowDays} 天{multi ? "，每個攤位一條線" : ""}
            </p>
            <Legend series={series} />

            <div
                role="img"
                aria-label={`每日營業額折線圖，近 ${windowDays} 天，${series.map((s) => s.name).join("、")}。詳細數字請看下方的表格。`}
                className="mt-3 -ml-1"
            >
                <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data} margin={{ top: 12, right: showEndLabels ? 52 : 12, left: 0, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="" />
                        <XAxis
                            dataKey="date"
                            tickFormatter={formatAxisDate}
                            tick={{ fontSize: 12, fill: AXIS_TEXT }}
                            tickLine={false}
                            axisLine={{ stroke: AXIS_LINE }}
                            interval="preserveStartEnd"
                            minTickGap={36}
                        />
                        <YAxis
                            tickFormatter={formatAxisMoney}
                            tick={{ fontSize: 12, fill: AXIS_TEXT }}
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            domain={[0, (max: number) => Math.max(10000, Math.ceil(max / 10000) * 10000)]}
                            tickCount={5}
                            allowDecimals={false}
                        />
                        <Tooltip
                            content={<TrendTooltip series={series} trend={trend} />}
                            cursor={{ stroke: "#a8a29e", strokeWidth: 1 }}
                            isAnimationActive={false}
                            position={{ y: 0 }}
                            wrapperStyle={{ outline: "none", zIndex: 20 }}
                        />
                        {series.map((s) => (
                            <Line
                                key={s.id}
                                dataKey={s.id}
                                name={s.name}
                                type="monotone"
                                stroke={s.color}
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                connectNulls
                                isAnimationActive={false}
                                activeDot={{ r: 5, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                                dot={(props: { cx?: number; cy?: number; index?: number }) => {
                                    const { cx, cy, index } = props;
                                    if (cx == null || cy == null || index !== lastIndex[s.id]) {
                                        return <g key={`dot-${s.id}-${index}`} />;
                                    }
                                    return (
                                        <g key={`dot-${s.id}-${index}`}>
                                            <circle cx={cx} cy={cy} r={5} fill={s.color} stroke={SURFACE} strokeWidth={2} />
                                            {showEndLabels ? (
                                                <text x={cx + 10} y={cy + 4} fontSize={12} fontWeight={700} fill={INK}>
                                                    {truncateLabel(s.name, 4)}
                                                </text>
                                            ) : null}
                                        </g>
                                    );
                                }}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <TableTwin summary="用表格看每天的數字" head={head} rows={rows} />
        </section>
    );
}

function CategoryTick(props: { x?: number; y?: number; payload?: { value?: string } }) {
    const { x = 0, y = 0, payload } = props;
    const full = payload?.value ?? "";
    return (
        <g transform={`translate(${x},${y})`}>
            <title>{full}</title>
            <text x={-8} y={0} dy={4} textAnchor="end" fontSize={13} fill={INK}>
                {truncateLabel(full, 6)}
            </text>
        </g>
    );
}

function ExpenseChart({ rows, barColor, windowDays }: { rows: ExpenseRow[]; barColor: string; windowDays: number }) {
    return (
        <section aria-labelledby="expense-title" className={cn(CARD, "p-4")}>
            <h2 id="expense-title" className="text-lg font-bold text-stone-900">支出分類</h2>
            <p className="mt-0.5 text-[15px] text-stone-600">近 {windowDays} 天，金額最高的前 {Math.min(12, Math.max(rows.length, 1))} 項</p>

            {rows.length === 0 ? (
                <p className="mt-4 rounded-xl bg-stone-50 px-4 py-6 text-center text-base text-stone-700">
                    這段期間沒有填過現金支出明細。
                </p>
            ) : (
                <>
                    <div
                        role="img"
                        aria-label={`支出分類長條圖，近 ${windowDays} 天，最高的是 ${rows[0].item}，${formatNtd(rows[0].amount)}。詳細數字請看下方的表格。`}
                        className="mt-3"
                    >
                        <ResponsiveContainer width="100%" height={rows.length * 34 + 16}>
                            <BarChart
                                layout="vertical"
                                data={rows}
                                margin={{ top: 4, right: 64, bottom: 4, left: 0 }}
                                barCategoryGap={10}
                            >
                                <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="" />
                                <XAxis type="number" hide domain={[0, "dataMax"]} />
                                <YAxis
                                    type="category"
                                    dataKey="item"
                                    width={92}
                                    tick={<CategoryTick />}
                                    tickLine={false}
                                    axisLine={{ stroke: AXIS_LINE }}
                                    interval={0}
                                />
                                <Tooltip
                                    cursor={{ fill: "rgba(120,113,108,0.10)" }}
                                    isAnimationActive={false}
                                    wrapperStyle={{ outline: "none", zIndex: 20 }}
                                    content={({ active, payload }: TooltipProps) => {
                                        if (!active || !payload?.[0]?.payload) return null;
                                        const p = payload[0].payload as unknown as ExpenseRow;
                                        return (
                                            <div className="rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-lg">
                                                <p className="text-base font-extrabold text-stone-900">{formatNtd(p.amount)}</p>
                                                <p className="text-[13px] text-stone-600">{p.item}</p>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="amount" fill={barColor} barSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                                    <LabelList
                                        dataKey="amount"
                                        position="right"
                                        formatter={(v: unknown) => formatNumber(Number(v))}
                                        style={{ fontSize: 13, fontWeight: 700, fill: INK }}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <TableTwin
                        summary="用表格看每一項的金額"
                        head={["項目", "金額"]}
                        rows={rows.map((r) => [r.item, formatNumber(r.amount)])}
                    />
                </>
            )}
        </section>
    );
}

export default function StatsClient({ series, trend, expenseBreakdown, barColor, windowDays }: Props) {
    return (
        <div className="space-y-4">
            {series.length === 0 || trend.length === 0 ? (
                <section className={cn(CARD, "p-4")}>
                    <h2 className="text-lg font-bold text-stone-900">每日營業額</h2>
                    <p className="mt-3 rounded-xl bg-stone-50 px-4 py-6 text-center text-base text-stone-700">
                        近 {windowDays} 天還沒有清點紀錄。
                    </p>
                </section>
            ) : (
                <TrendChart series={series} trend={trend} windowDays={windowDays} />
            )}
            <ExpenseChart rows={expenseBreakdown} barColor={barColor} windowDays={windowDays} />
        </div>
    );
}
