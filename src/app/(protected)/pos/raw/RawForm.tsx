"use client";

import { useState } from "react";
import { btnCls, fieldCls } from "../ui";

export type RawTableOption = {
    key: string;
    label: string;
    columns: Array<{ key: string; label: string; hint: string }>;
};

export default function RawForm({
    tables,
    initialTable,
    initialCol,
    initialQ,
    initialAll,
}: {
    tables: RawTableOption[];
    initialTable: string;
    initialCol: string;
    initialQ: string;
    initialAll: boolean;
}) {
    const [table, setTable] = useState(initialTable);
    const [col, setCol] = useState(initialCol);
    const cols = tables.find((t) => t.key === table)?.columns ?? [];
    const hint = cols.find((c) => c.key === col)?.hint ?? "先選要搜尋的欄位";

    return (
        <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
                資料
                <select
                    name="table"
                    value={table}
                    onChange={(e) => {
                        setTable(e.target.value);
                        setCol("");
                        // 換資料表就直接重新查，搜尋欄位清單才會跟著換
                        const form = e.currentTarget.form;
                        if (form) {
                            const q = form.elements.namedItem("q") as HTMLInputElement | null;
                            if (q) q.value = "";
                            setTimeout(() => form.requestSubmit(), 0);
                        }
                    }}
                    className={fieldCls}
                >
                    {tables.map((t) => (
                        <option key={t.key} value={t.key}>
                            {t.label}
                        </option>
                    ))}
                </select>
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
                搜尋欄位
                <select name="col" value={col} onChange={(e) => setCol(e.target.value)} className={fieldCls}>
                    <option value="">（不篩選）</option>
                    {cols.map((c) => (
                        <option key={c.key} value={c.key}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </label>
            <label className="text-xs text-muted-foreground flex flex-col gap-1">
                包含文字
                <input
                    type="text"
                    name="q"
                    defaultValue={initialQ}
                    placeholder={hint}
                    disabled={!col}
                    className={fieldCls + " w-56"}
                />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm">
                <input
                    type="checkbox"
                    name="all"
                    value="1"
                    defaultChecked={initialAll}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="h-4 w-4"
                />
                顯示全部欄位
            </label>
            <button type="submit" className={btnCls}>
                查詢
            </button>
        </form>
    );
}
