"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download, Printer } from "lucide-react";
import { isSameRange, quickRanges } from "@/lib/cash-ui";
import { btn, CARD, INPUT } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

type Props = {
    defaultFrom?: string;
    defaultTo?: string;
    isAdmin: boolean;
    /** server 算好的「今天」（跟新增清點表單同一套日期規則） */
    today: string;
};

/**
 * 歷史頁工具列：快速區間（今天 / 近 7 天 / 本月）+ 自訂日期 + 匯出 / 列印。
 * 快速區間只是幫忙組 from / to 參數（純前端），URL 參數 from / to / loc 的格式與以前相容；
 * 切換區間時會保留其他參數（例如管理者選的攤位 loc）。
 */
export default function HistoryToolbar({ defaultFrom, defaultTo, isAdmin, today }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [from, setFrom] = useState(defaultFrom ?? "");
    const [to, setTo] = useState(defaultTo ?? "");
    const [isPending, startTransition] = useTransition();

    const ranges = quickRanges(today);
    const chips = [
        { key: "all", label: "全部日期", range: null as null | { from: string; to: string } },
        { key: "today", label: "今天", range: ranges.today },
        { key: "last7", label: "近 7 天", range: ranges.last7 },
        { key: "month", label: "本月", range: ranges.thisMonth },
    ];
    const activeChip = chips.find((c) =>
        c.range ? isSameRange(defaultFrom, defaultTo, c.range) : !defaultFrom && !defaultTo,
    )?.key;
    // 目前的區間不是任何一個快速選項 → 自訂日期預設展開，讓人看得到現在篩的是什麼
    const customActive = !activeChip;

    function pushRange(nextFrom: string, nextTo: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (nextFrom) params.set("from", nextFrom); else params.delete("from");
        if (nextTo) params.set("to", nextTo); else params.delete("to");
        setFrom(nextFrom);
        setTo(nextTo);
        const qs = params.toString();
        startTransition(() => router.push(qs ? `/cash/history?${qs}` : "/cash/history"));
    }

    function applyFilter() {
        pushRange(from, to);
    }

    function exportCsv() {
        // 簡單做法：把當前 URL 參數（含管理者選的攤位 loc）帶給 API route
        const params = new URLSearchParams(searchParams.toString());
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        window.location.href = `/api/cash/export?${params.toString()}`;
    }

    function printPdf() {
        window.print();
    }

    return (
        <section aria-label="選擇期間與匯出" className={cn(CARD, "space-y-3 p-4 print:hidden")}>
            <div role="group" aria-label="快速選擇期間" className="flex flex-wrap items-center gap-2">
                {chips.map((c) => {
                    const active = c.key === activeChip;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            aria-pressed={active}
                            disabled={isPending}
                            onClick={() => (c.range ? pushRange(c.range.from, c.range.to) : pushRange("", ""))}
                            className={cn(
                                "inline-flex min-h-11 items-center rounded-full border px-4 text-[15px] font-bold transition-colors duration-150 disabled:opacity-60 motion-reduce:transition-none",
                                active
                                    ? "border-amber-700 bg-amber-700 text-white"
                                    : "border-stone-300 bg-white text-stone-900 hover:bg-stone-100 active:bg-stone-200",
                            )}
                        >
                            {c.label}
                        </button>
                    );
                })}
            </div>

            <details open={customActive} className="group border-t border-stone-200 pt-1">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] font-bold text-amber-900 [&::-webkit-details-marker]:hidden">
                    自訂日期範圍
                    <ChevronDown className="h-5 w-5 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                </summary>
                <div className="space-y-3 pb-1 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1 block text-[15px] font-bold text-stone-900">從</span>
                            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-[15px] font-bold text-stone-900">至</span>
                            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
                        </label>
                    </div>
                    <button
                        type="button"
                        onClick={applyFilter}
                        disabled={isPending}
                        aria-busy={isPending}
                        className={btn("primary", "md", "w-full")}
                    >
                        {isPending ? "查詢中…" : "套用日期"}
                    </button>
                </div>
            </details>

            <div className="grid grid-cols-2 gap-2 border-t border-stone-200 pt-3 sm:flex sm:flex-wrap">
                {isAdmin && (
                    <button type="button" onClick={exportCsv} className={btn("secondary", "md")} title="匯出成 Excel 可以開的 CSV 檔">
                        <Download className="h-5 w-5" aria-hidden="true" />
                        匯出 CSV
                    </button>
                )}
                <button
                    type="button"
                    onClick={printPdf}
                    className={btn("secondary", "md", isAdmin ? "" : "col-span-2 sm:col-span-1")}
                    title="用瀏覽器列印，或存成 PDF"
                >
                    <Printer className="h-5 w-5" aria-hidden="true" />
                    列印 / PDF
                </button>
            </div>
        </section>
    );
}
