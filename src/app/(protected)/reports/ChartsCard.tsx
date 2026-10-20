"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, getUnitLabel } from "@/lib/units";
import { PIE_COLORS, type ReportsClientProps } from "./reports-types";

type Props = Pick<ReportsClientProps, "dailyStats" | "topItems" | "expenseBreakdown" | "units">;

export function ChartsCard({ dailyStats, topItems, expenseBreakdown, units }: Props) {
    const [chartTab, setChartTab] = useState<"line" | "bar" | "pie">("line");

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">數據圖表</CardTitle>
                    <div className="flex gap-1">
                        {([
                            { key: "line", label: "趨勢" },
                            { key: "bar", label: "品項" },
                            { key: "pie", label: "支出" },
                        ] as const).map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setChartTab(tab.key)}
                                className={[
                                    "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                                    chartTab === tab.key
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:bg-accent",
                                ].join(" ")}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {/* Line Chart - Daily Revenue & Cost */}
                {chartTab === "line" && (
                    <div className="h-64 sm:h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dailyStats} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={60} />
                                <Tooltip
                                    formatter={(value) => formatPrice(Number(value ?? 0))}
                                    contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: '8px' }}
                                    labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '4px' }}
                                    itemStyle={{ color: '#cbd5e1' }}
                                />
                                <Line type="monotone" dataKey="revenue" name="營收" stroke="#0EA5E9" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="cost" name="成本" stroke="#F97316" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Bar Chart - Top Items */}
                {chartTab === "bar" && (
                    <div className="space-y-4">
                        <div className="h-64 sm:h-72">
                            {topItems.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                    尚無進貨資料
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={topItems} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} width={60} />
                                        <Tooltip
                                            formatter={(value) => formatPrice(Number(value ?? 0))}
                                            contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: '8px' }}
                                            labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '4px' }}
                                            itemStyle={{ color: '#cbd5e1' }}
                                        />
                                        <Bar dataKey="totalCost" name="成本" fill="#6366F1" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                        {topItems.length > 0 && (
                            <div className="grid gap-2 sm:grid-cols-2 text-sm">
                                {topItems.map((item) => {
                                    const quantityLabel = item.totalWeightKg > 0
                                        ? `${item.totalWeightKg.toFixed(2)} 公斤`
                                        : `${item.totalQuantity} ${getUnitLabel(item.unit, units)}`;
                                    return (
                                        <div key={item.name} className="flex justify-between py-1.5 px-3 rounded-lg bg-accent/30">
                                            <span className="text-muted-foreground truncate mr-2">{item.name}</span>
                                            <span className="font-medium whitespace-nowrap">{formatPrice(item.totalCost)} · {quantityLabel}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Pie Chart - Expense Breakdown */}
                {chartTab === "pie" && (
                    <div className="space-y-4">
                        <div className="h-64 sm:h-72">
                            {expenseBreakdown.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                    尚無支出資料
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={expenseBreakdown}
                                            dataKey="total"
                                            nameKey="label"
                                            innerRadius="40%"
                                            outerRadius="75%"
                                            paddingAngle={3}
                                        >
                                            {expenseBreakdown.map((_, index) => (
                                                <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value) => formatPrice(Number(value ?? 0))}
                                            contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: '8px' }}
                                            labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: '4px' }}
                                            itemStyle={{ color: '#cbd5e1' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                        {expenseBreakdown.length > 0 && (
                            <div className="grid gap-2 sm:grid-cols-2 text-sm">
                                {expenseBreakdown.map((item, i) => (
                                    <div key={item.type} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-accent/30">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="w-3 h-3 rounded-full flex-shrink-0"
                                                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                                            />
                                            <span className="text-muted-foreground">{item.label}</span>
                                        </div>
                                        <span className="font-medium">{formatPrice(item.total)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
