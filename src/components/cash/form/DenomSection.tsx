"use client";

import { Minus, Plus } from "lucide-react";
import { diffStatus, formatNtd, sanitizeCount, stepCount, type DiffStatus } from "@/lib/cash-ui";
import { cn } from "@/lib/utils";
import { DiffChip, InfoChip } from "../StatusChip";
import SectionCard from "./SectionCard";

type Props = {
    step: number;
    title: string;
    description: string;
    denoms: number[];
    /** 各面額的參考張數；null = 這一區沒有目標 */
    targetQty: Record<number, number> | null;
    /** 目標總額；null = 這一區沒有目標（營業現金） */
    targetTotal: number | null;
    values: Record<string, string>;
    onChange: (denom: string, value: string) => void;
    total: number;
};

/**
 * 面額清點區塊（錢盒 / 備用金 / 營業現金共用）。
 *
 * 一列一個面額：左邊面額與參考張數、中間 -/數量/+、右邊小計。
 * - 數量輸入框高 48px、字級 18px、聚焦時全選，+/- 鈕 44px，單手、手有油也按得到
 * - 只允許數字（伺服器端要求非負整數）；計算本身（面額 x 張數）與原本完全相同
 * - 區塊標頭顯示合計與差額狀態；目標值一律由 props 傳入（來源是 cash-constants.ts，不在這裡寫死）
 */
export default function DenomSection({
    step,
    title,
    description,
    denoms,
    targetQty,
    targetTotal,
    values,
    onChange,
    total,
}: Props) {
    const status: DiffStatus | null = targetTotal === null ? null : diffStatus(total, targetTotal);

    return (
        <SectionCard
            step={step}
            title={title}
            description={description}
            status={
                status ? (
                    <DiffChip status={status} />
                ) : (
                    <InfoChip tone="muted">{total > 0 ? formatNtd(total) : "尚未填寫"}</InfoChip>
                )
            }
        >
            <ul className="divide-y divide-stone-200">
                {denoms.map((d) => {
                    const v = values[String(d)] ?? "";
                    const amt = d * (Number(v) || 0);
                    const reference = targetQty ? targetQty[d] : undefined;
                    return (
                        <li key={d} className="flex min-h-[4.25rem] items-center gap-1.5 px-3 py-2">
                            <div className="w-16 shrink-0 leading-tight">
                                <div className="whitespace-nowrap">
                                    <span className="text-xl font-bold tabular-nums text-stone-900">{d}</span>
                                    <span className="ml-0.5 text-sm text-stone-600">元</span>
                                </div>
                                {targetQty ? (
                                    <div className="mt-0.5 text-[13px] text-stone-600">
                                        {reference !== undefined ? `參考 ${reference}` : "不固定"}
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex flex-1 items-center justify-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => onChange(String(d), stepCount(v, -1))}
                                    aria-label={`${d} 元的張數減 1`}
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-800 transition-colors duration-150 active:bg-stone-200 motion-reduce:transition-none"
                                >
                                    <Minus className="h-5 w-5" aria-hidden="true" />
                                </button>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    autoComplete="off"
                                    enterKeyHint="next"
                                    value={v}
                                    onChange={(e) => onChange(String(d), sanitizeCount(e.target.value))}
                                    onFocus={(e) => {
                                        const el = e.currentTarget;
                                        // iOS 要等一個 frame 才能真的全選
                                        requestAnimationFrame(() => el.select());
                                    }}
                                    aria-label={`${d} 元的張數`}
                                    placeholder="0"
                                    className="h-12 w-14 scroll-mt-36 rounded-xl border border-stone-300 bg-white text-center text-lg font-bold tabular-nums text-stone-900 placeholder:text-stone-400"
                                />
                                <button
                                    type="button"
                                    onClick={() => onChange(String(d), stepCount(v, 1))}
                                    aria-label={`${d} 元的張數加 1`}
                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-800 transition-colors duration-150 active:bg-stone-200 motion-reduce:transition-none"
                                >
                                    <Plus className="h-5 w-5" aria-hidden="true" />
                                </button>
                            </div>

                            <div
                                className={cn(
                                    "w-16 shrink-0 text-right text-base font-bold tabular-nums",
                                    amt > 0 ? "text-stone-900" : "text-stone-500",
                                )}
                            >
                                {amt > 0 ? amt.toLocaleString("en-US") : <span aria-label="0">—</span>}
                            </div>
                        </li>
                    );
                })}
            </ul>

            <div className="border-t border-stone-200 bg-stone-50 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-bold text-stone-900">合計</span>
                    <span className="text-xl font-extrabold tabular-nums text-stone-900">
                        {total > 0 ? formatNtd(total) : "—"}
                    </span>
                </div>
                {status && targetTotal !== null && status.kind !== "empty" ? (
                    <p
                        className={cn(
                            "mt-1 text-[15px] font-semibold",
                            status.kind === "balanced" ? "text-emerald-800" : "text-red-800",
                        )}
                    >
                        目標 {formatNtd(targetTotal)}，{status.detail}
                    </p>
                ) : null}
            </div>
        </SectionCard>
    );
}
