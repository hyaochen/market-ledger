import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import type { DiffStatus } from "@/lib/cash-ui";
import { chip, type Tone } from "./ui";

/**
 * 差額狀態徽章：一律「文字 + 圖示 + 顏色」三件一起，不只靠顏色分辨。
 * 螢幕閱讀器會多念一段白話說明（例如「差 -100，比目標少 100 元」）。
 */
export function DiffChip({ status, className }: { status: DiffStatus; className?: string }) {
    const tone: Tone = status.kind === "balanced" ? "ok" : status.kind === "empty" ? "muted" : "bad";
    const Icon = status.kind === "balanced" ? CircleCheck : status.kind === "empty" ? CircleDashed : TriangleAlert;
    return (
        <span className={chip(tone, className)}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{status.label}</span>
            <span className="sr-only">，{status.detail}</span>
        </span>
    );
}

/** 一般的小標籤（金額、進度等），可指定語氣與圖示。 */
export function InfoChip({
    tone = "muted",
    icon: Icon,
    children,
    className,
}: {
    tone?: Tone;
    icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span className={chip(tone, className)}>
            {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
            {children}
        </span>
    );
}
