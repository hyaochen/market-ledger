import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { formatNtd, type DiffStatus } from "@/lib/cash-ui";
import { cn } from "@/lib/utils";

type Props = {
    totalSales: number;
    cashBox: DiffStatus;
    reserve: DiffStatus;
};

function MiniStatus({ name, status }: { name: string; status: DiffStatus }) {
    const Icon = status.kind === "balanced" ? CircleCheck : status.kind === "empty" ? CircleDashed : TriangleAlert;
    return (
        <li
            className={cn(
                "flex items-center justify-end gap-1.5 text-[13px] font-semibold leading-tight",
                status.kind === "balanced" ? "text-emerald-800" : status.kind === "empty" ? "text-stone-600" : "text-red-800",
            )}
        >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
                {name} {status.label}
            </span>
        </li>
    );
}

/**
 * 捲動後仍可見的精簡黏性條：今日營業額 + 錢盒狀態 + 備用金狀態。
 * 貼在標頭下方（標頭高 4rem + 安全區），不會蓋到輸入欄（輸入框有 scroll-mt 預留）。
 * 列印時不顯示。
 */
export default function SummaryBar({ totalSales, cashBox, reserve }: Props) {
    return (
        <div
            role="group"
            aria-label="目前合計"
            className="sticky top-[calc(4rem+env(safe-area-inset-top,0px))] z-30 -mx-4 border-b border-stone-200 bg-white px-4 py-2 shadow-sm print:hidden md:mx-0 md:rounded-xl md:border"
        >
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[13px] text-stone-600">今日營業額</div>
                    <div className="truncate text-xl font-extrabold tabular-nums text-stone-900">
                        {totalSales > 0 ? formatNtd(totalSales) : "—"}
                    </div>
                </div>
                <ul className="shrink-0 space-y-0.5">
                    <MiniStatus name="錢盒" status={cashBox} />
                    <MiniStatus name="備用金" status={reserve} />
                </ul>
            </div>
        </div>
    );
}
