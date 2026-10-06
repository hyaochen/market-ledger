import { cn } from "@/lib/utils";
import { CARD } from "../ui";

type Props = {
    /** 步驟編號（用 CSS 圓形徽章顯示，不用圓圈數字字元） */
    step: number;
    title: string;
    /** 標題右側的狀態（徽章） */
    status?: React.ReactNode;
    /** 標題下方的一行說明 */
    description?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
};

/**
 * 清點表單每個區塊共用的外框：步驟徽章 + 標題 + 狀態徽章 + 說明。
 * 卡片內不再套卡片，區塊內用分隔線切列。
 */
export default function SectionCard({ step, title, status, description, children, className }: Props) {
    const headingId = `cash-step-${step}-title`;
    return (
        <section aria-labelledby={headingId} className={cn(CARD, "overflow-hidden", className)}>
            <header className="border-b border-stone-200 px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 items-center gap-3">
                        <span
                            aria-hidden="true"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-700 text-base font-bold text-white"
                        >
                            {step}
                        </span>
                        <h2 id={headingId} className="text-lg font-bold text-stone-900">
                            {title}
                        </h2>
                    </div>
                    {status}
                </div>
                {description ? <p className="mt-1.5 text-[15px] leading-snug text-stone-600">{description}</p> : null}
            </header>
            {children}
        </section>
    );
}
