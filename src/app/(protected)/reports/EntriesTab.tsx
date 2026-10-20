"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { formatPrice, formatQuantityDisplay } from "@/lib/units";
import { type ReportsClientProps, type EntryRow } from "./reports-types";

type Props = {
    entries: EntryRow[];
    expenseTypes: ReportsClientProps["expenseTypes"];
    canEdit: boolean;
    entryDeleting: string | null;
    openEntryEditor: (entry: EntryRow) => void;
    handleEntryDelete: (entryId: string) => void;
};

export function EntriesTab({ entries, expenseTypes, canEdit, entryDeleting, openEntryEditor, handleEntryDelete }: Props) {
    const [entryFilter, setEntryFilter] = useState<"all" | "PURCHASE" | "EXPENSE">("all");
    const [search, setSearch] = useState("");

    const expenseTypeMap = useMemo(
        () => new Map(expenseTypes.map((item) => [item.value, item.label] as const)),
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

    return (
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
    );
}
