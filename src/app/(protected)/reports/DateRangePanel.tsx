"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, BarChart3, Calendar, CalendarDays, CalendarRange, History, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarPicker } from "./CalendarPicker";

export function DateRangePanel({ range, earliestDate }: { range: { from: string; to: string }; earliestDate?: string | null }) {
    const router = useRouter();
    const [customFrom, setCustomFrom] = useState(range.from);
    const [customTo, setCustomTo] = useState(range.to);

    /* ─── Preset helpers ─── */
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const now = new Date();
    const dayOfWeek = now.getDay() || 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31);

    const presets: { label: string; from: string; to: string; icon: LucideIcon }[] = [
        { label: "今日", from: fmt(now), to: fmt(now), icon: Calendar },
        { label: "本週", from: fmt(weekStart), to: fmt(now), icon: CalendarRange },
        { label: "本月", from: fmt(monthStart), to: fmt(now), icon: CalendarDays },
        { label: "上月", from: fmt(lastMonthStart), to: fmt(lastMonthEnd), icon: History },
        { label: "今年", from: fmt(yearStart), to: fmt(yearEnd), icon: BarChart3 },
    ];
    if (earliestDate) {
        presets.push({ label: "全部", from: earliestDate, to: fmt(now), icon: Archive });
    }

    const isActivePreset = (p: { from: string; to: string }) => p.from === range.from && p.to === range.to;

    const goToRange = (from: string, to: string) => {
        router.push(`/reports?from=${from}&to=${to}`);
    };

    return (
        <Card>
            <CardContent className="p-4 space-y-4">
                {/* Quick Presets */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {presets.map((p) => (
                        <button
                            key={p.label}
                            onClick={() => goToRange(p.from, p.to)}
                            className={[
                                "flex flex-col items-center justify-center gap-0.5 py-3 px-2 rounded-xl text-sm font-medium transition-all active:scale-95",
                                isActivePreset(p)
                                    ? "bg-primary text-primary-foreground shadow-md"
                                    : "bg-accent/40 hover:bg-accent/70 text-foreground",
                            ].join(" ")}
                        >
                            <p.icon className="h-5 w-5" aria-hidden="true" />
                            <span>{p.label}</span>
                        </button>
                    ))}
                </div>

                {/* Custom Date Range */}
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
                    <CalendarPicker
                        label="起始日期"
                        value={customFrom}
                        onChange={setCustomFrom}
                    />
                    <CalendarPicker
                        label="結束日期"
                        value={customTo}
                        onChange={setCustomTo}
                    />
                    <Button
                        onClick={() => goToRange(customFrom, customTo)}
                        className="h-12 text-base font-semibold"
                    >
                        查詢
                    </Button>
                </div>

                {/* Current Range Display + Export */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                        查詢範圍：<span className="font-medium text-foreground">{range.from}</span>
                        {" ~ "}
                        <span className="font-medium text-foreground">{range.to}</span>
                    </div>
                    <div className="flex gap-2">
                        <a href={`/reports/export?from=${range.from}&to=${range.to}&type=entries`}>
                            <Button variant="outline" size="sm">匯出進貨/支出</Button>
                        </a>
                        <a href={`/reports/export?from=${range.from}&to=${range.to}&type=revenues`}>
                            <Button variant="outline" size="sm">匯出營收</Button>
                        </a>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
