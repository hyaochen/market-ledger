"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { btn, CARD, INPUT } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

type Props = {
    defaultFrom?: string;
    defaultTo?: string;
    isAdmin: boolean;
    /** server 算好的「今天」（跟新增清點表單同一套日期規則） */
    today: string;
};

export default function HistoryToolbar({ defaultFrom, defaultTo, isAdmin }: Props) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [from, setFrom] = useState(defaultFrom ?? "");
    const [to, setTo] = useState(defaultTo ?? "");
    const [isPending, startTransition] = useTransition();

    function applyFilter() {
        const params = new URLSearchParams(searchParams.toString());
        if (from) params.set("from", from); else params.delete("from");
        if (to) params.set("to", to); else params.delete("to");
        startTransition(() => router.push(`/cash/history?${params.toString()}`));
    }

    function exportCsv() {
        // 簡單做法：把當前 URL 帶 export=csv 給 API route
        const params = new URLSearchParams(searchParams.toString());
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        window.location.href = `/api/cash/export?${params.toString()}`;
    }

    function printPdf() {
        window.print();
    }

    return (
        <section aria-label="篩選日期與匯出" className={cn(CARD, "space-y-3 p-4 print:hidden")}>
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

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button
                    type="button"
                    onClick={applyFilter}
                    disabled={isPending}
                    aria-busy={isPending}
                    className={btn("primary", "md", "col-span-2 sm:col-span-1")}
                >
                    {isPending ? "查詢中…" : "套用日期"}
                </button>
                {isAdmin && (
                    <button type="button" onClick={exportCsv} className={btn("secondary", "md")} title="匯出成 Excel 可以開的 CSV 檔">
                        <Download className="h-5 w-5" aria-hidden="true" />
                        匯出 CSV
                    </button>
                )}
                <button type="button" onClick={printPdf} className={btn("secondary", "md")} title="用瀏覽器列印，或存成 PDF">
                    <Printer className="h-5 w-5" aria-hidden="true" />
                    列印 / PDF
                </button>
            </div>
        </section>
    );
}
