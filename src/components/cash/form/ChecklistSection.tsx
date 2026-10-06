"use client";

import { Check, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoChip } from "../StatusChip";
import SectionCard from "./SectionCard";

type Item = { id: string; name: string };

type Props = {
    step: number;
    items: Item[];
    checkedIds: Set<string>;
    onToggle: (id: string) => void;
};

/**
 * 動作清點：整列都是點擊範圍（高度 >= 56px），打勾後文字不劃線，
 * 改成淡綠底 + 右側「已完成」文字，不只靠顏色分辨。
 */
export default function ChecklistSection({ step, items, checkedIds, onToggle }: Props) {
    const done = items.filter((i) => checkedIds.has(i.id)).length;
    const allDone = items.length > 0 && done === items.length;

    return (
        <SectionCard
            step={step}
            title="動作清點"
            description="每做完一件事就打勾。"
            status={
                <InfoChip tone={allDone ? "ok" : "muted"} icon={ListChecks}>
                    已完成 {done} / {items.length}
                </InfoChip>
            }
        >
            {items.length === 0 ? (
                <p className="px-4 py-4 text-base text-stone-700">還沒有設定動作項目，請聯絡管理者。</p>
            ) : (
                <ul className="divide-y divide-stone-200">
                    {items.map((c) => {
                        const checked = checkedIds.has(c.id);
                        return (
                            <li key={c.id}>
                                <label
                                    className={cn(
                                        "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors duration-150 motion-reduce:transition-none",
                                        checked ? "bg-emerald-50" : "bg-white active:bg-stone-100",
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => onToggle(c.id)}
                                        className="h-7 w-7 shrink-0 accent-emerald-700"
                                    />
                                    <span className="flex-1 text-lg font-semibold text-stone-900">{c.name}</span>
                                    {checked ? (
                                        <span className="inline-flex items-center gap-1 text-[15px] font-bold text-emerald-800">
                                            <Check className="h-5 w-5" aria-hidden="true" />
                                            已完成
                                        </span>
                                    ) : null}
                                </label>
                            </li>
                        );
                    })}
                </ul>
            )}
        </SectionCard>
    );
}
