"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Props = {
    defaultFrom?: string;
    defaultTo?: string;
    isAdmin: boolean;
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
        <div className="bg-amber-50 border border-amber-200 rounded-md p-2 flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
                <span className="text-zinc-600">從</span>
                <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="border border-zinc-300 rounded px-1.5 py-0.5"
                />
            </label>
            <label className="flex items-center gap-1">
                <span className="text-zinc-600">至</span>
                <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="border border-zinc-300 rounded px-1.5 py-0.5"
                />
            </label>
            <button
                type="button"
                onClick={applyFilter}
                disabled={isPending}
                className="bg-amber-600 text-white px-2.5 py-1 rounded disabled:opacity-50"
            >
                套用
            </button>
            <div className="ml-auto flex gap-2">
                {isAdmin && (
                    <button
                        type="button"
                        onClick={exportCsv}
                        className="border border-zinc-400 px-2.5 py-1 rounded hover:bg-white"
                        title="匯出 CSV (Excel 可開)"
                    >
                        匯出 CSV
                    </button>
                )}
                <button
                    type="button"
                    onClick={printPdf}
                    className="border border-zinc-400 px-2.5 py-1 rounded hover:bg-white"
                    title="瀏覽器列印 → 存 PDF"
                >
                    列印 / PDF
                </button>
            </div>
        </div>
    );
}
