import Link from "next/link";
import { CalendarX2, ChevronRight, CircleCheck, ListChecks, TriangleAlert, type LucideIcon } from "lucide-react";
import { listCashAlerts, type CashAlert } from "@/app/actions/cash";
import { formatMonthDayWeekday } from "@/lib/cash-ui";
import { CARD, chip, type Tone } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

/**
 * 異常清單（管理者）。內容仍是 listCashAlerts() 的原樣輸出，只改成分組卡片：
 * 差額未平 / 動作沒打勾 / 整天缺漏。每一組都有圖示 + 文字 + 數量，不只靠顏色。
 */
export default async function CashAlertsPage() {
    const alerts = await listCashAlerts();

    const grouped = {
        diff: alerts.filter((a) => a.type === "diff"),
        checklist: alerts.filter((a) => a.type === "checklist"),
        missing: alerts.filter((a) => a.type === "missing"),
    };

    return (
        <div className="space-y-4 px-4 pb-4 pt-2 md:pt-4">
            <header>
                <h1 className="text-2xl font-bold text-stone-900">異常清單</h1>
                <p className="mt-0.5 text-[15px] text-stone-600">最近 90 筆清點紀錄裡，需要看一下的地方</p>
            </header>

            {alerts.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-10 text-center">
                    <CircleCheck className="h-10 w-10 text-emerald-700" aria-hidden="true" />
                    <p className="mt-3 text-lg font-bold text-emerald-900">最近 90 筆清點紀錄都沒有異常</p>
                    <p className="mt-1 text-base text-emerald-900">錢盒和備用金都平，動作也都有打勾，沒有漏掉的日子。</p>
                </div>
            ) : null}

            <AlertSection
                title="錢盒或備用金差額沒有平"
                icon={TriangleAlert}
                tone="bad"
                alerts={grouped.diff}
            />
            <AlertSection
                title="動作沒有全部打勾"
                icon={ListChecks}
                tone="warn"
                alerts={grouped.checklist}
            />
            <AlertSection
                title="整天沒有清點紀錄"
                icon={CalendarX2}
                tone="muted"
                alerts={grouped.missing}
            />
        </div>
    );
}

function AlertSection({
    title,
    icon: Icon,
    tone,
    alerts,
}: {
    title: string;
    icon: LucideIcon;
    tone: Tone;
    alerts: CashAlert[];
}) {
    if (alerts.length === 0) return null;
    return (
        <section aria-label={title} className={cn(CARD, "overflow-hidden")}>
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
                <h2 className="flex items-center gap-2 text-lg font-bold text-stone-900">
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {title}
                </h2>
                <span className={chip(tone)}>{alerts.length} 筆</span>
            </div>
            <ul className="divide-y divide-stone-200">
                {alerts.map((a, i) => {
                    const body = (
                        <>
                            <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-base font-bold text-stone-900">{formatMonthDayWeekday(a.date)}</span>
                                    {a.locationName ? (
                                        <span className={chip("warn", "px-2.5 py-0.5 text-[13px]")}>{a.locationName}</span>
                                    ) : null}
                                </p>
                                <p className="mt-1 text-[15px] leading-snug text-stone-700">{a.detail}</p>
                            </div>
                            {a.cashCountId ? (
                                <span className="flex shrink-0 items-center gap-0.5 text-[15px] font-bold text-amber-900">
                                    查看
                                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                                </span>
                            ) : null}
                        </>
                    );
                    const key = `${a.type}-${a.date}-${i}`;
                    return (
                        <li key={key}>
                            {a.cashCountId ? (
                                <Link
                                    href={`/cash/history/${a.cashCountId}`}
                                    className="flex min-h-[3.75rem] items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-amber-50 active:bg-amber-100 motion-reduce:transition-none"
                                >
                                    {body}
                                </Link>
                            ) : (
                                <div className="flex min-h-[3.75rem] items-center gap-3 px-4 py-3">{body}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
