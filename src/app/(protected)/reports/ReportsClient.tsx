"use client";

import { useMemo, useState } from "react";
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
import { formatPrice, getUnitLabel, type UnitDef } from "@/lib/units";
import { deleteEntry, updateEntry } from "@/app/actions/entry";
import { updateRevenue } from "@/app/actions/revenue";

const PIE_COLORS = ["#F97316", "#22C55E", "#0EA5E9", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981"];

type ReportsClientProps = {
    roleCode: "read" | "write" | "admin";
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

    const [entryDialogOpen, setEntryDialogOpen] = useState(false);
    const [revenueDialogOpen, setRevenueDialogOpen] = useState(false);
    const [entryForm, setEntryForm] = useState<ReportsClientProps["entries"][number] | null>(null);
    const [revenueForm, setRevenueForm] = useState<ReportsClientProps["revenues"][number] | null>(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryDeleting, setEntryDeleting] = useState<string | null>(null);
    const [revenueLoading, setRevenueLoading] = useState(false);
    const [entryFilter, setEntryFilter] = useState<"all" | "PURCHASE" | "EXPENSE">("all");
    const [search, setSearch] = useState("");

    const expenseTypeMap = useMemo(
        () => new Map(expenseTypes.map((item) => [item.value, item.label])),
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

    const openEntryEditor = (entry: ReportsClientProps["entries"][number]) => {
        setEntryForm({
            ...entry,
            inputUnit: entry.inputUnit || units[0]?.code || "kg",
        });
        setEntryDialogOpen(true);
    };

    const openRevenueEditor = (record: ReportsClientProps["revenues"][number]) => {
        setRevenueForm({ ...record });
        setRevenueDialogOpen(true);
    };

    const canEdit = roleCode === "write" || roleCode === "admin";

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

    return (
        <div className="space-y-6 pb-24">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight">報表與分析</h1>
                <p className="text-muted-foreground text-sm">查詢、統計並快速修正資料。</p>
            </header>

            <Card>
                <CardContent className="space-y-4 p-4">
                    <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" method="get">
                        <div className="space-y-1">
                            <Label>起始日期</Label>
                            <Input type="date" name="from" defaultValue={range.from} />
                        </div>
                        <div className="space-y-1">
                            <Label>結束日期</Label>
                            <Input type="date" name="to" defaultValue={range.to} />
                        </div>
                        <Button type="submit" className="w-full sm:w-auto">查詢</Button>
                    </form>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <a href={`/reports/export?from=${range.from}&to=${range.to}&type=entries`}>
                            <Button variant="outline" className="w-full">匯出進貨/支出 (CSV)</Button>
                        </a>
                        <a href={`/reports/export?from=${range.from}&to=${range.to}&type=revenues`}>
                            <Button variant="outline" className="w-full">匯出營收 (CSV)</Button>
                        </a>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">總營收</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold text-primary">
                        {formatPrice(totals.revenue)}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">總成本</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold">
                        {formatPrice(totals.cost)}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">預估獲利</CardTitle>
                    </CardHeader>
                    <CardContent className="text-2xl font-bold">
                        {formatPrice(totals.profit)}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">每日營收與成本</CardTitle>
                    </CardHeader>
                    <CardContent className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={dailyStats} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip formatter={(value: number) => formatPrice(value)} />
                                <Line type="monotone" dataKey="revenue" name="營收" stroke="#0EA5E9" strokeWidth={2} />
                                <Line type="monotone" dataKey="cost" name="成本" stroke="#F97316" strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">支出類型占比</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="h-64">
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
                                        innerRadius={50}
                                        outerRadius={90}
                                        paddingAngle={3}
                                    >
                                        {expenseBreakdown.map((_, index) => (
                                            <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(value: number) => formatPrice(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    {expenseBreakdown.length > 0 && (
                        <div className="space-y-2 text-sm">
                            {expenseBreakdown.map((item) => (
                                <div key={item.type} className="flex justify-between">
                                    <span className="text-muted-foreground">{item.label}</span>
                                    <span className="font-medium">{formatPrice(item.total)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">高成本品項</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="h-56">
                        {topItems.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                尚無進貨資料
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topItems} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 12 }} />
                                    <Tooltip formatter={(value: number) => formatPrice(value)} />
                                    <Bar dataKey="totalCost" name="成本" fill="#6366F1" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    {topItems.length > 0 && (
                        <div className="space-y-2 text-sm">
                            {topItems.map((item) => {
                                const quantityLabel = item.totalWeightKg > 0
                                    ? `${item.totalWeightKg.toFixed(2)} 公斤`
                                    : `${item.totalQuantity} ${getUnitLabel(item.unit, units)}`;
                                return (
                                    <div key={item.name} className="flex justify-between">
                                        <span className="text-muted-foreground">{item.name}</span>
                                        <span className="font-medium">
                                            {formatPrice(item.totalCost)} · {quantityLabel}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Tabs defaultValue="entries" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="entries">進貨/支出記錄</TabsTrigger>
                    <TabsTrigger value="revenues">營收記錄</TabsTrigger>
                </TabsList>

                <TabsContent value="entries" className="space-y-4">
                    <Card>
                        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex gap-2">
                                <Button
                                    variant={entryFilter === "all" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setEntryFilter("all")}
                                >
                                    全部
                                </Button>
                                <Button
                                    variant={entryFilter === "PURCHASE" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setEntryFilter("PURCHASE")}
                                >
                                    進貨
                                </Button>
                                <Button
                                    variant={entryFilter === "EXPENSE" ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setEntryFilter("EXPENSE")}
                                >
                                    支出
                                </Button>
                            </div>
                            <Input
                                placeholder="搜尋品項/廠商/備註"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="sm:max-w-xs"
                            />
                        </CardContent>
                    </Card>

                    <div className="space-y-3">
                        {filteredEntries.length === 0 ? (
                            <Card>
                                <CardContent className="p-8 text-center text-muted-foreground">
                                    目前沒有符合條件的紀錄。
                                </CardContent>
                            </Card>
                        ) : (
                            filteredEntries.map((entry) => (
                                <Card key={entry.id}>
                                    <CardContent className="flex flex-col gap-2 p-4">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <div className="font-semibold">
                                                    {entry.type === "PURCHASE"
                                                        ? entry.itemName || "未命名品項"
                                                        : expenseTypeMap.get(entry.expenseType) || entry.expenseType}
                                                </div>
                                                <div className="text-xs text-muted-foreground">{entry.date}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold text-primary">{formatPrice(entry.totalPrice)}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {entry.type === "PURCHASE"
                                                        ? `${entry.inputQuantity} ${getUnitLabel(entry.inputUnit, units)}`
                                                        : "其他支出"}
                                                </div>
                                            </div>
                                        </div>
                                        {entry.type === "PURCHASE" && (
                                            <div className="text-xs text-muted-foreground">廠商：{entry.vendorName || "未填"}</div>
                                        )}
                                        {entry.note && (
                                            <div className="text-xs text-muted-foreground">備註：{entry.note}</div>
                                        )}
                                        {canEdit && (
                                            <div className="flex gap-2">
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
                                                    {entryDeleting === entry.id ? "刪除中..." : "刪除"}
                                                </Button>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="revenues" className="space-y-3">
                    {revenues.length === 0 ? (
                        <Card>
                            <CardContent className="p-8 text-center text-muted-foreground">
                                尚無營收紀錄。
                            </CardContent>
                        </Card>
                    ) : (
                        revenues.map((record) => (
                            <Card key={record.id}>
                                <CardContent className="flex items-center justify-between gap-4 p-4">
                                    <div>
                                        <div className="font-semibold">{record.locationName}</div>
                                        <div className="text-xs text-muted-foreground">{record.date}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-primary">
                                            {record.isDayOff ? "休假" : formatPrice(record.amount)}
                                        </div>
                                        {canEdit && (
                                            <Button variant="outline" size="sm" onClick={() => openRevenueEditor(record)}>
                                                編輯
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </TabsContent>
            </Tabs>

            <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
                <DialogContent className="max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>編輯記錄</DialogTitle>
                    </DialogHeader>
                    {entryForm && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>日期</Label>
                                <Input
                                    type="date"
                                    value={entryForm.date}
                                    onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                                />
                            </div>
                            {entryForm.type === "PURCHASE" ? (
                                <>
                                    <div className="space-y-2">
                                        <Label>品項</Label>
                                        <Select
                                            value={entryForm.itemId}
                                            onValueChange={(value) => setEntryForm({ ...entryForm, itemId: value })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="選擇品項" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {items.map((item) => (
                                                    <SelectItem key={item.id} value={item.id}>
                                                        {item.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>廠商</Label>
                                        <Select
                                            value={entryForm.vendorId || "none"}
                                            onValueChange={(value) =>
                                                setEntryForm({ ...entryForm, vendorId: value === "none" ? "" : value })
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="選擇廠商" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">未指定</SelectItem>
                                                {vendors.map((vendor) => (
                                                    <SelectItem key={vendor.id} value={vendor.id}>
                                                        {vendor.name}
                                                    </SelectItem>
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
                                                    setEntryForm({
                                                        ...entryForm,
                                                        inputQuantity: Number.isFinite(value) ? value : 0,
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>單位</Label>
                                            <Select
                                                value={entryForm.inputUnit}
                                                onValueChange={(value) => setEntryForm({ ...entryForm, inputUnit: value })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {units.map((unit) => (
                                                        <SelectItem key={unit.code} value={unit.code}>
                                                            {unit.name}
                                                        </SelectItem>
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
                                                setEntryForm({
                                                    ...entryForm,
                                                    totalPrice: Number.isFinite(value) ? value : 0,
                                                });
                                            }}
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <Label>支出項目</Label>
                                        <Select
                                            value={entryForm.expenseType}
                                            onValueChange={(value) => setEntryForm({ ...entryForm, expenseType: value })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="選擇支出" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {expenseTypes.map((item) => (
                                                    <SelectItem key={item.value} value={item.value}>
                                                        {item.label}
                                                    </SelectItem>
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
                                                setEntryForm({
                                                    ...entryForm,
                                                    totalPrice: Number.isFinite(value) ? value : 0,
                                                });
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

            <Dialog open={revenueDialogOpen} onOpenChange={setRevenueDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>編輯營收</DialogTitle>
                    </DialogHeader>
                    {revenueForm && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>日期</Label>
                                <Input
                                    type="date"
                                    value={revenueForm.date}
                                    onChange={(e) => setRevenueForm({ ...revenueForm, date: e.target.value })}
                                />
                            </div>
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
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    checked={revenueForm.isDayOff}
                                    onChange={(e) =>
                                        setRevenueForm({ ...revenueForm, isDayOff: e.target.checked })
                                    }
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
