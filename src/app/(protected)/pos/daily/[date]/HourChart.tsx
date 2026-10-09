"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Row = { hour: number; orders: number; total: number };

function fill(rows: Row[]): Array<{ label: string; orders: number; total: number }> {
    if (rows.length === 0) return [];
    const lo = Math.min(...rows.map((r) => r.hour));
    const hi = Math.max(...rows.map((r) => r.hour));
    const map = new Map(rows.map((r) => [r.hour, r]));
    const out = [];
    for (let h = lo; h <= hi; h++) {
        const r = map.get(h);
        out.push({ label: String(h).padStart(2, "0"), orders: r?.orders ?? 0, total: r?.total ?? 0 });
    }
    return out;
}

const tooltipStyle = { backgroundColor: "#1e1e2e", border: "1px solid #333", borderRadius: "8px" };

export default function HourChart({ rows }: { rows: Row[] }) {
    const data = fill(rows);
    if (data.length === 0) return <p className="text-sm text-muted-foreground">沒有時段資料</p>;
    return (
        <div className="space-y-4">
            <div>
                <div className="mb-1 text-xs text-muted-foreground">每小時營收（結帳時間）</div>
                <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} width={48} />
                            <Tooltip
                                formatter={(v) => Number(v ?? 0).toLocaleString("en-US")}
                                labelFormatter={(l) => `${l}:00-${l}:59`}
                                contentStyle={tooltipStyle}
                                labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                                itemStyle={{ color: "#cbd5e1" }}
                            />
                            <Bar dataKey="total" name="營收" fill="#6366F1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div>
                <div className="mb-1 text-xs text-muted-foreground">每小時單數</div>
                <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} width={48} allowDecimals={false} />
                            <Tooltip
                                formatter={(v) => `${v} 單`}
                                labelFormatter={(l) => `${l}:00-${l}:59`}
                                contentStyle={tooltipStyle}
                                labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                                itemStyle={{ color: "#cbd5e1" }}
                            />
                            <Bar dataKey="orders" name="單數" fill="#22C55E" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
