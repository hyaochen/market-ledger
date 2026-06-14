"use client";

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
} from "recharts";

type TrendRow = { date: string; totalSales: number; sales: number; expenses: number };
type ExpenseRow = { item: string; amount: number };

type Props = {
    trend: TrendRow[];
    expenseBreakdown: ExpenseRow[];
};

export default function StatsClient({ trend, expenseBreakdown }: Props) {
    return (
        <div className="space-y-4">
            <section className="border border-zinc-200 bg-white rounded-md p-3">
                <h2 className="text-sm font-bold mb-2">每日營業額趨勢</h2>
                {trend.length === 0 ? (
                    <p className="text-xs text-zinc-500">近 90 天無資料。</p>
                ) : (
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={trend} margin={{ top: 5, right: 15, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="totalSales" stroke="#b56500" strokeWidth={2} dot={{ r: 2 }} name="今日營業額" />
                            <Line type="monotone" dataKey="sales" stroke="#1a7a3e" strokeWidth={1} dot={false} name="現金" />
                            <Line type="monotone" dataKey="expenses" stroke="#c0392b" strokeWidth={1} dot={false} name="支出" />
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </section>

            <section className="border border-zinc-200 bg-white rounded-md p-3">
                <h2 className="text-sm font-bold mb-2">支出分類加總（前 12 項）</h2>
                {expenseBreakdown.length === 0 ? (
                    <p className="text-xs text-zinc-500">近 90 天無支出明細。</p>
                ) : (
                    <ResponsiveContainer width="100%" height={Math.max(180, expenseBreakdown.length * 24)}>
                        <BarChart data={expenseBreakdown} layout="vertical" margin={{ top: 5, right: 15, left: 60, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" tick={{ fontSize: 10 }} />
                            <YAxis type="category" dataKey="item" tick={{ fontSize: 10 }} width={80} />
                            <Tooltip />
                            <Bar dataKey="amount" fill="#b56500" name="金額" />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </section>
        </div>
    );
}
