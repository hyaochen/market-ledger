"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
    PieChart,
    Pie,
    Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatPrice, getUnitLabel, formatQuantityDisplay, type UnitDef } from "@/lib/units";
import { deleteEntry, updateEntry } from "@/app/actions/entry";
import { deleteRevenue, updateRevenue } from "@/app/actions/revenue";

const PIE_COLORS = ["#F97316", "#22C55E", "#0EA5E9", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981"];

/* ─── Calendar Picker Component ─── */

function CalendarPicker({
    value,
    onChange,
    label,
    minDate,
}: {
    value: string;
    onChange: (date: string) => void;
    label: string;
    minDate?: string;
}) {
    const [open, setOpen] = useState(false);
    const [viewYear, setViewYear] = useState(() => {
        const d = value ? new Date(value + "T00:00:00") : new Date();
        return d.getFullYear();
    });
    const [viewMonth, setViewMonth] = useState(() => {
        const d = value ? new Date(value + "T00:00:00") : new Date();
        return d.getMonth();
    });

    // Use local date format (not UTC) to avoid timezone offset issues
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

    const displayDate = value
        ? (() => {
            const d = new Date(value + "T00:00:00");
            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
        })()
        : "選擇日期";

    const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

    const handleSelect = (day: number) => {
        const selected = fmt(new Date(viewYear, viewMonth, day));
        onChange(selected);
        setOpen(false);
    };

    const prevMonth = () => {
        if (viewMonth === 0) {
            setViewYear(viewYear - 1);
            setViewMonth(11);
        } else {
            setViewMonth(viewMonth - 1);
        }
    };

    const nextMonth = () => {
        if (viewMonth === 11) {
            setViewYear(viewYear + 1);
            setViewMonth(0);
        } else {
            setViewMonth(viewMonth + 1);
        }
    };

    const isSelected = (day: number) => {
        if (!value) return false;
        return value === fmt(new Date(viewYear, viewMonth, day));
    };

    const isToday = (day: number) => {
        const today = new Date();
        return (
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day
        );
    };

    return (
        <div className="relative">
            <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full h-12 px-4 rounded-lg border border-input bg-background text-base font-medium hover:bg-accent/50 transition-colors active:scale-[0.98]"
            >
                <span className={value ? "" : "text-muted-foreground"}>{displayDate}</span>
                <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute z-50 top-full left-0 mt-2 w-full min-w-[280px] bg-background border border-border rounded-xl shadow-lg p-3 animate-in fade-in zoom-in-95 duration-150">
                        {/* Month/Year Header */}
                        <div className="flex items-center justify-between mb-3">
                            <button
                                type="button"
                                onClick={prevMonth}
                                className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent active:scale-95 transition-all"
                            >
                                ‹
                            </button>
                            <span className="text-sm font-semibold">
                                {viewYear} 年 {viewMonth + 1} 月
                            </span>
                            <button
                                type="button"
                                onClick={nextMonth}
                                className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent active:scale-95 transition-all"
                            >
                                ›
                            </button>
                        </div>

                        {/* Weekday Headers */}
                        <div className="grid grid-cols-7 gap-0.5 mb-1">
                            {weekDays.map((d) => (
                                <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">
                                    {d}
                                </div>
                            ))}
                        </div>

                        {/* Day Grid */}
                        <div className="grid grid-cols-7 gap-0.5">
                            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                                <div key={`empty-${i}`} />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const selected = isSelected(day);
                                const today = isToday(day);
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => handleSelect(day)}
                                        className={[
                                            "h-9 w-full rounded-lg text-sm font-medium transition-all active:scale-90",
                                            selected
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : today
                                                    ? "bg-accent text-accent-foreground font-bold"
                                                    : "hover:bg-accent/60",
                                        ].join(" ")}
                                    >
                                        {day}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Quick Jump to Today */}
                        <button
                            type="button"
                            onClick={() => {
                                const now = new Date();
                                setViewYear(now.getFullYear());
                                setViewMonth(now.getMonth());
                                handleSelect(now.getDate());
                            }}
                            className="w-full mt-2 h-8 text-xs text-primary hover:bg-accent rounded-lg transition-colors"
                        >
                            今天
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

/* ─── Main Component ─── */

type ReportsClientProps = {
    roleCode: "read" | "write" | "admin";
    earliestDate?: string | null;
    range: { from: string; to: string };
    totals: { revenue: number; cost: number; profit: number };
    dailyStats: { date: string; revenue: number; cost: number }[];
    topItems: { name: string; totalCost: number; totalWeightKg: number; totalQuantity: number; unit: string }[];
    expenseBreakdown: { type: string; label: string; total: number }[];
    entries: {
        id: string;
        type: string;
        date: string;
        itemId: string;
        itemName: string;
        vendorId: string;
        vendorName: string;
        inputQuantity: number;
        inputUnit: string;
        totalPrice: number;
        expenseType: string;
        note: string;
    }[];
    revenues: {
        id: string;
        date: string;
        locationId: string;
        locationName: string;
        amount: number;
        isDayOff: boolean;
    }[];
    items: any[];
    vendors: any[];
    expenseTypes: any[];
    units: UnitDef[];
};

export default function ReportsClient({
    roleCode,
    earliestDate,
    range,
    totals,
    dailyStats,
    topItems,
    expenseBreakdown,
    entries,
    revenues,
    items,
    vendors,
    expenseTypes,
    units,
}: ReportsClientProps) {
    const router = useRouter();
    const { toast } = useToast();

    const [customFrom, setCustomFrom] = useState(range.from);
    const [customTo, setCustomTo] = useState(range.to);
    const [entryDialogOpen, setEntryDialogOpen] = useState(false);
    const [revenueDialogOpen, setRevenueDialogOpen] = useState(false);
    const [entryForm, setEntryForm] = useState<ReportsClientProps["entries"][number] | null>(null);
    const [revenueForm, setRevenueForm] = useState<ReportsClientProps["revenues"][number] | null>(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryDeleting, setEntryDeleting] = useState<string | null>(null);
    const [revenueLoading, setRevenueLoading] = useState(false);
    const [revenueDeleting, setRevenueDeleting] = useState<string | null>(null);
    const [entryFilter, setEntryFilter] = useState<"all" | "PURCHASE" | "EXPENSE">("all");
    const [search, setSearch] = useState("");
    const [chartTab, setChartTab] = useState<"line" | "bar" | "pie">("line");

    const expenseTypeMap = useMemo(
        () => new Map(expenseTypes.map((item: any) => [item.value, item.label])),
        [expenseTypes]
    );

    const filteredEntries = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return entries.filter((entry) => {
            if (entryFilter !== "all" && entry.type !== entryFilter) return false;
            if (!keyword) return true;
            const label = entry.type === "EXPENSE" ? expenseTypeMap.get(entry.expenseType) || "" : entry.itemName;
            const haystack = [label, entry.vendorName, entry.note, entry.expenseType].join(" ").toLowerCase();
            return haystack.includes(keyword);
        });
    }, [entries, entryFilter, expenseTypeMap, search]);

    const canEdit = roleCode === "write" || roleCode === "admin";

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

    const presets: { label: string; from: string; to: string; icon: string }[] = [
        { label: "今日", from: fmt(now), to: fmt(now), icon: "📅" },
        { label: "本週", from: fmt(weekStart), to: fmt(now), icon: "📆" },
        { label: "本月", from: fmt(monthStart), to: fmt(now), icon: "🗓" },
        { label: "上月", from: fmt(lastMonthStart), to: fmt(lastMonthEnd), icon: "⏪" },
        { label: "今年", from: fmt(yearStart), to: fmt(yearEnd), icon: "📊" },
    ];
    if (earliestDate) {
        presets.push({ label: "全部", from: earliestDate, to: fmt(now), icon: "🗃" });
    }

    const isActivePreset = (p: { from: string; to: string }) => p.from === range.from && p.to === range.to;

    const goToRange = (from: string, to: string) => {
        router.push(`/reports?from=${from}&to=${to}`);
    };

    /* ─── Edit Handlers ─── */
    const openEntryEditor = (entry: ReportsClientProps["entries"][number]) => {
        setEntryForm({ ...entry, inputUnit: entry.inputUnit || units[0]?.code || "kg" });
        setEntryDialogOpen(true);
    };

    const openRevenueEditor = (record: ReportsClientProps["revenues"][number]) => {
        setRevenueForm({ ...record });
        setRevenueDialogOpen(true);
    };

    const handleEntrySave = async () => {
        if (!entryForm) return;
        if (!canEdit) {
            toast({ title: "權限不足", description: "此帳號僅能查看", variant: "destructive" });
            return;
        }
        setEntryLoading(true);
        const formData = new FormData();
        formData.append("type", entryForm.type);
        formData.append("date", entryForm.date);
        if (entryForm.type === "PURCHASE") {
            formData.append("itemId", entryForm.itemId);
            formData.append("vendorId", entryForm.vendorId || "none");
            formData.append("weight", entryForm.inputQuantity.toString());
            formData.append("unit", entryForm.inputUnit);
            formData.append("price", entryForm.totalPrice.toString());
            formData.append("note", entryForm.note || "");
        } else {
            formData.append("expenseType", entryForm.expenseType);
            formData.append("amount", entryForm.totalPrice.toString());
            formData.append("note", entryForm.note || "");
        }
        const result = await updateEntry(entryForm.id, formData);
        setEntryLoading(false);
        if (result.success) {
            toast({ title: "已更新", description: "記錄已儲存" });
            setEntryDialogOpen(false);
            router.refresh();
        } else {
            toast({ title: "更新失敗", description: result.message, variant: "destructive" });
        }
    };

    const handleEntryDelete = async (entryId: string) => {
        if (!canEdit) {
            toast({ title: "權限不足", description: "此帳號僅能查看", variant: "destructive" });
            return;
        }
        if (!confirm("確定要刪除此筆記錄嗎？")) return;
        setEntryDeleting(entryId);
        const result = await deleteEntry(entryId);
        setEntryDeleting(null);
        if (result.success) {
            toast({ title: "已刪除", description: "記錄已刪除" });
            router.refresh();
        } else {
            toast({ title: "刪除失敗", description: result.message, variant: "destructive" });
        }
    };

    const handleRevenueSave = async () => {
        if (!revenueForm) return;
        if (!canEdit) {
            toast({ title: "權限不足", description: "此帳號僅能查看", variant: "destructive" });
            return;
        }
        setRevenueLoading(true);
        const formData = new FormData();
        formData.append("date", revenueForm.date);
        formData.append("amount", revenueForm.amount.toString());
        if (revenueForm.isDayOff) formData.append("isDayOff", "on");
        const result = await updateRevenue(revenueForm.id, formData);
        setRevenueLoading(false);
        if (result.success) {
            toast({ title: "已更新", description: "營收已更新" });
            setRevenueDialogOpen(false);
            router.refresh();
        } else {
            toast({ title: "更新失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleRevenueDelete = async (recordId: string) => {
        if (!canEdit) {
            toast({ title: "權限不足", description: "此帳號僅能查看", variant: "destructive" });
            return;
        }
        if (!confirm("確定要刪除此筆營收記錄嗎？")) return;
        setRevenueDeleting(recordId);
        const result = await deleteRevenue(recordId);
        setRevenueDeleting(null);
        if (result.success) {
            toast({ title: "已刪除", description: "營收記錄已刪除" });
            router.refresh();
        } else {
            toast({ title: "刪除失敗", description: result.error, variant: "destructive" });
        }
    };

    return (
        <div className="space-y-5 pb-24">
            {/* ─── Header ─── */}
            <header>
                <h1 className="text-2xl font-bold tracking-tight">報表與分析</h1>
                <p className="text-muted-foreground text-sm mt-0.5">查詢、統計並快速修正資料</p>
            </header>

            {/* ─── Date Selection Panel ─── */}
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
                                <span className="text-lg leading-none">{p.icon}</span>
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

            {/* ─── Summary Cards ─── */}
            <div className="grid gap-3 grid-cols-3">
                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 to-transparent" />
                    <CardContent className="p-4 relative">
                        <p className="text-xs text-muted-foreground mb-1">總營收</p>
                        <p className="text-lg sm:text-2xl font-bold text-sky-600">{formatPrice(totals.revenue)}</p>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent" />
                    <CardContent className="p-4 relative">
                        <p className="text-xs text-muted-foreground mb-1">總成本</p>
                        <p className="text-lg sm:text-2xl font-bold text-orange-600">{formatPrice(totals.cost)}</p>
                    </CardContent>
                </Card>
                <Card className="relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
                    <CardContent className="p-4 relative">
                        <p className="text-xs text-muted-foreground mb-1">預估獲利</p>
                        <p className={`text-lg sm:text-2xl font-bold ${totals.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {formatPrice(totals.profit)}
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* ─── Charts ─── */}
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

            {/* ─── Data Records ─── */}
            <Tabs defaultValue="entries" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="entries">進貨/支出記錄 ({entries.length})</TabsTrigger>
                    <TabsTrigger value="revenues">營收記錄 ({revenues.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="entries" className="space-y-3 mt-3">
                    {/* Filters */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex gap-1.5">
                            {([
                                { key: "all", label: "全部" },
                                { key: "PURCHASE", label: "進貨" },
                                { key: "EXPENSE", label: "支出" },
                            ] as const).map((f) => (
                                <Button
                                    key={f.key}
                                    variant={entryFilter === f.key ? "default" : "outline"}
                                    size="sm"
                                    className="h-9"
                                    onClick={() => setEntryFilter(f.key)}
                                >
                                    {f.label}
                                </Button>
                            ))}
                        </div>
                        <Input
                            placeholder="搜尋品項/廠商/備註"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="sm:max-w-xs h-9"
                        />
                    </div>

                    {/* Entry List */}
                    <div className="space-y-2">
                        {filteredEntries.length === 0 ? (
                            <Card>
                                <CardContent className="p-8 text-center text-muted-foreground">
                                    目前沒有符合條件的紀錄。
                                </CardContent>
                            </Card>
                        ) : (
                            filteredEntries.map((entry) => (
                                <Card key={entry.id} className="hover:shadow-sm transition-shadow">
                                    <CardContent className="p-3 sm:p-4 space-y-2.5">
                                        {/* Row 1: Badge + Title + Price */}
                                        <div className="flex items-start gap-3">
                                            <div className={[
                                                "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold",
                                                entry.type === "PURCHASE"
                                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                            ].join(" ")}>
                                                {entry.type === "PURCHASE" ? "進" : "支"}
                                            </div>
                                            <div className="flex-1 min-w-0 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
                                                <span className="font-semibold break-words">
                                                    {entry.type === "PURCHASE"
                                                        ? entry.itemName || "未命名品項"
                                                        : expenseTypeMap.get(entry.expenseType) || entry.expenseType}
                                                </span>
                                                <span className="font-bold text-primary text-lg whitespace-nowrap">
                                                    {formatPrice(entry.totalPrice)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Row 2: Metadata (wraps) */}
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground pl-[52px]">
                                            <span>{entry.date}</span>
                                            {entry.type === "PURCHASE" && (
                                                <>
                                                    <span>·</span>
                                                    <span>{formatQuantityDisplay(entry.inputQuantity, entry.inputUnit)}</span>
                                                    {entry.vendorName && (
                                                        <>
                                                            <span>·</span>
                                                            <span>{entry.vendorName}</span>
                                                        </>
                                                    )}
                                                </>
                                            )}
                                            {entry.note && (
                                                <>
                                                    <span>·</span>
                                                    <span className="break-words">{entry.note}</span>
                                                </>
                                            )}
                                        </div>

                                        {/* Row 3: Actions */}
                                        {canEdit && (
                                            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                                                <Button variant="outline" size="sm" onClick={() => openEntryEditor(entry)}>
                                                    編輯
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive"
                                                    disabled={entryDeleting === entry.id}
                                                    onClick={() => handleEntryDelete(entry.id)}
                                                >
                                                    {entryDeleting === entry.id ? "處理中..." : "刪除"}
                                                </Button>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="revenues" className="space-y-2 mt-3">
                    {revenues.length === 0 ? (
                        <Card>
                            <CardContent className="p-8 text-center text-muted-foreground">
                                尚無營收紀錄。
                            </CardContent>
                        </Card>
                    ) : (
                        revenues.map((record) => (
                            <Card key={record.id} className="hover:shadow-sm transition-shadow">
                                <CardContent className="p-3 sm:p-4 space-y-2.5">
                                    {/* Row 1: Badge + Location + Amount */}
                                    <div className="flex items-start gap-3">
                                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                            營
                                        </div>
                                        <div className="flex-1 min-w-0 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
                                            <span className="font-semibold break-words">{record.locationName}</span>
                                            <span className="font-bold text-primary text-lg whitespace-nowrap">
                                                {record.isDayOff ? "休假" : formatPrice(record.amount)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Row 2: Date */}
                                    <div className="text-xs text-muted-foreground pl-[52px]">{record.date}</div>

                                    {/* Row 3: Actions */}
                                    {canEdit && (
                                        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                                            <Button variant="outline" size="sm" onClick={() => openRevenueEditor(record)}>
                                                編輯
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive"
                                                disabled={revenueDeleting === record.id}
                                                onClick={() => handleRevenueDelete(record.id)}
                                            >
                                                {revenueDeleting === record.id ? "處理中..." : "刪除"}
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>
            </Tabs>

            {/* ─── Entry Edit Dialog ─── */}
            <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>編輯記錄</DialogTitle>
                    </DialogHeader>
                    {entryForm && (
                        <div className="space-y-4">
                            <CalendarPicker
                                label="日期"
                                value={entryForm.date}
                                onChange={(date) => setEntryForm({ ...entryForm, date })}
                            />
                            {entryForm.type === "PURCHASE" ? (
                                <>
                                    <div className="space-y-2">
                                        <Label>品項</Label>
                                        <Select value={entryForm.itemId} onValueChange={(value) => setEntryForm({ ...entryForm, itemId: value })}>
                                            <SelectTrigger><SelectValue placeholder="選擇品項" /></SelectTrigger>
                                            <SelectContent>
                                                {items.map((item: any) => (
                                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>廠商</Label>
                                        <Select
                                            value={entryForm.vendorId || "none"}
                                            onValueChange={(value) => setEntryForm({ ...entryForm, vendorId: value === "none" ? "" : value })}
                                        >
                                            <SelectTrigger><SelectValue placeholder="選擇廠商" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">未指定</SelectItem>
                                                {vendors.map((vendor: any) => (
                                                    <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>數量</Label>
                                            <Input
                                                type="number"
                                                value={entryForm.inputQuantity}
                                                onChange={(e) => {
                                                    const value = Number.parseFloat(e.target.value);
                                                    setEntryForm({ ...entryForm, inputQuantity: Number.isFinite(value) ? value : 0 });
                                                }}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>單位</Label>
                                            <Select value={entryForm.inputUnit} onValueChange={(value) => setEntryForm({ ...entryForm, inputUnit: value })}>
                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {units.map((unit) => (
                                                        <SelectItem key={unit.code} value={unit.code}>{unit.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>總金額 (TWD)</Label>
                                        <Input
                                            type="number"
                                            value={entryForm.totalPrice}
                                            onChange={(e) => {
                                                const value = Number.parseFloat(e.target.value);
                                                setEntryForm({ ...entryForm, totalPrice: Number.isFinite(value) ? value : 0 });
                                            }}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <Label>支出項目</Label>
                                        <Select value={entryForm.expenseType} onValueChange={(value) => setEntryForm({ ...entryForm, expenseType: value })}>
                                            <SelectTrigger><SelectValue placeholder="選擇支出" /></SelectTrigger>
                                            <SelectContent>
                                                {expenseTypes.map((item: any) => (
                                                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>金額 (TWD)</Label>
                                        <Input
                                            type="number"
                                            value={entryForm.totalPrice}
                                            onChange={(e) => {
                                                const value = Number.parseFloat(e.target.value);
                                                setEntryForm({ ...entryForm, totalPrice: Number.isFinite(value) ? value : 0 });
                                            }}
                                        />
                                    </div>
                                </>
                            )}
                            <div className="space-y-2">
                                <Label>備註</Label>
                                <Input
                                    value={entryForm.note}
                                    onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button onClick={handleEntrySave} disabled={entryLoading}>
                            {entryLoading ? "儲存中..." : "儲存"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ─── Revenue Edit Dialog ─── */}
            <Dialog open={revenueDialogOpen} onOpenChange={setRevenueDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>編輯營收</DialogTitle>
                    </DialogHeader>
                    {revenueForm && (
                        <div className="space-y-4">
                            <CalendarPicker
                                label="日期"
                                value={revenueForm.date}
                                onChange={(date) => setRevenueForm({ ...revenueForm, date })}
                            />
                            <div className="space-y-2">
                                <Label>金額 (TWD)</Label>
                                <Input
                                    type="number"
                                    value={revenueForm.amount}
                                    disabled={revenueForm.isDayOff}
                                    onChange={(e) => {
                                        const value = Number.parseFloat(e.target.value);
                                        setRevenueForm({ ...revenueForm, amount: Number.isFinite(value) ? value : 0 });
                                    }}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="edit-dayoff"
                                    className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                    checked={revenueForm.isDayOff}
                                    onChange={(e) => setRevenueForm({ ...revenueForm, isDayOff: e.target.checked })}
                                />
                                <Label htmlFor="edit-dayoff">此日休假</Label>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button onClick={handleRevenueSave} disabled={revenueLoading}>
                            {revenueLoading ? "儲存中..." : "儲存"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
