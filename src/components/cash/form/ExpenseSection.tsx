"use client";

import { Plus } from "lucide-react";
import { formatNtd, sanitizeAmount } from "@/lib/cash-ui";
import type { ExpenseRow } from "@/lib/cash-draft";
import { btn, INPUT } from "../ui";
import { InfoChip } from "../StatusChip";
import SectionCard from "./SectionCard";
import { selectOnFocus } from "./selectOnFocus";
import { cn } from "@/lib/utils";

type Props = {
    step: number;
    rows: ExpenseRow[];
    total: number;
    onChange: (index: number, key: keyof ExpenseRow, value: string) => void;
    onAddRow: () => void;
};

/**
 * 當天現金支出明細（項目 / 備註 / 金額）。
 *
 * 版面：每列單行三欄（項目、備註、金額），輸入框一律高 48px；
 * 這樣預設 6 列只佔約 430px，不會把整頁撐得很長。DOM 順序 = 視覺順序 = Tab 順序。
 * 空白列提交時由 server action 過濾（行為與原本相同），所以保留預設 6 列不縮減。
 */
export default function ExpenseSection({ step, rows, total, onChange, onAddRow }: Props) {
    return (
        <SectionCard
            step={step}
            title="當天現金支出明細"
            description="從錢盒或營業現金付出去的錢（進貨、零工、雜支），寫完會自動加總。"
            status={<InfoChip tone="muted">{total > 0 ? formatNtd(total) : "尚未填寫"}</InfoChip>}
        >
            <ul className="divide-y divide-stone-200">
                {rows.map((row, i) => (
                    <li
                        key={i}
                        className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_5.5rem] gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_8rem]"
                    >
                        <input
                            type="text"
                            autoComplete="off"
                            aria-label={`第 ${i + 1} 筆支出的項目`}
                            placeholder="項目"
                            value={row.item}
                            onChange={(e) => onChange(i, "item", e.target.value)}
                            className={cn(INPUT, "scroll-mt-36 px-2.5")}
                        />
                        <input
                            type="text"
                            autoComplete="off"
                            aria-label={`第 ${i + 1} 筆支出的備註（選填）`}
                            placeholder="備註"
                            value={row.note}
                            onChange={(e) => onChange(i, "note", e.target.value)}
                            className={cn(INPUT, "scroll-mt-36 px-2.5")}
                        />
                        <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={`第 ${i + 1} 筆支出的金額`}
                            placeholder="金額"
                            value={row.amount}
                            onChange={(e) => onChange(i, "amount", sanitizeAmount(e.target.value))}
                            onFocus={selectOnFocus}
                            className={cn(INPUT, "scroll-mt-36 px-2.5 text-right font-bold tabular-nums")}
                        />
                    </li>
                ))}
            </ul>

            <div className="border-t border-stone-200 px-3 py-3">
                <button type="button" onClick={onAddRow} className={btn("secondary", "md", "w-full")}>
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    新增一列
                </button>
            </div>

            <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3">
                <span className="text-base font-bold text-stone-900">支出合計</span>
                <span className="text-xl font-extrabold tabular-nums text-stone-900">{total > 0 ? formatNtd(total) : "—"}</span>
            </div>
        </SectionCard>
    );
}
