"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { deleteEntry, updateEntry } from "@/app/actions/entry";
import { deleteRevenue, updateRevenue } from "@/app/actions/revenue";
import { type ReportsClientProps, type EntryRow, type RevenueRow } from "./reports-types";
import { DateRangePanel } from "./DateRangePanel";
import { SummaryCards } from "./SummaryCards";
import { ChartsCard } from "./ChartsCard";
import { EntriesTab } from "./EntriesTab";
import { RevenuesTab } from "./RevenuesTab";
import { EntryEditDialog } from "./EntryEditDialog";
import { RevenueEditDialog } from "./RevenueEditDialog";

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

    const [entryDialogOpen, setEntryDialogOpen] = useState(false);
    const [revenueDialogOpen, setRevenueDialogOpen] = useState(false);
    const [entryForm, setEntryForm] = useState<EntryRow | null>(null);
    const [revenueForm, setRevenueForm] = useState<RevenueRow | null>(null);
    const [entryLoading, setEntryLoading] = useState(false);
    const [entryDeleting, setEntryDeleting] = useState<string | null>(null);
    const [revenueLoading, setRevenueLoading] = useState(false);
    const [revenueDeleting, setRevenueDeleting] = useState<string | null>(null);

    const canEdit = roleCode === "write" || roleCode === "admin";

    /* ─── Edit Handlers ─── */
    const openEntryEditor = (entry: EntryRow) => {
        setEntryForm({ ...entry, inputUnit: entry.inputUnit || units[0]?.code || "kg" });
        setEntryDialogOpen(true);
    };

    const openRevenueEditor = (record: RevenueRow) => {
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

            <DateRangePanel range={range} earliestDate={earliestDate} />
            <SummaryCards totals={totals} />
            <ChartsCard dailyStats={dailyStats} topItems={topItems} expenseBreakdown={expenseBreakdown} units={units} />

            {/* ─── Data Records ─── */}
            <Tabs defaultValue="entries" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="entries">進貨/支出記錄 ({entries.length})</TabsTrigger>
                    <TabsTrigger value="revenues">營收記錄 ({revenues.length})</TabsTrigger>
                </TabsList>
                <EntriesTab
                    entries={entries}
                    expenseTypes={expenseTypes}
                    canEdit={canEdit}
                    entryDeleting={entryDeleting}
                    openEntryEditor={openEntryEditor}
                    handleEntryDelete={handleEntryDelete}
                />
                <RevenuesTab
                    revenues={revenues}
                    canEdit={canEdit}
                    revenueDeleting={revenueDeleting}
                    openRevenueEditor={openRevenueEditor}
                    handleRevenueDelete={handleRevenueDelete}
                />
            </Tabs>

            <EntryEditDialog
                open={entryDialogOpen}
                onOpenChange={setEntryDialogOpen}
                form={entryForm}
                setForm={setEntryForm}
                loading={entryLoading}
                onSave={handleEntrySave}
                items={items}
                vendors={vendors}
                expenseTypes={expenseTypes}
                units={units}
            />
            <RevenueEditDialog
                open={revenueDialogOpen}
                onOpenChange={setRevenueDialogOpen}
                form={revenueForm}
                setForm={setRevenueForm}
                loading={revenueLoading}
                onSave={handleRevenueSave}
            />
        </div>
    );
}
