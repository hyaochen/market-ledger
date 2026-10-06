import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Circle, TriangleAlert } from "lucide-react";
import { getCashCountById } from "@/app/actions/cash";
import {
    CASH_BOX_DENOMS,
    CASH_BOX_TARGET_TOTAL,
    RESERVE_DENOMS,
    RESERVE_TARGET_TOTAL,
    SALES_DENOMS,
} from "@/lib/cash-constants";
import { diffStatus, formatDateWithWeekday, formatNtd, formatTaipeiDateTime } from "@/lib/cash-ui";
import { btn, CARD } from "@/components/cash/ui";
import { DiffChip } from "@/components/cash/StatusChip";
import { cn } from "@/lib/utils";
import PrintButton from "./PrintButton";

type DenomMap = Record<string, number>;
type ExpenseRow = { item: string; note?: string; amount: number };

function safeParseDenom(json: string): DenomMap {
    try {
        const v = JSON.parse(json);
        if (v && typeof v === "object") return v as DenomMap;
    } catch { /* noop */ }
    return {};
}
function safeParseExpenses(json: string): ExpenseRow[] {
    try {
        const v = JSON.parse(json);
        if (Array.isArray(v)) return v as ExpenseRow[];
    } catch { /* noop */ }
    return [];
}

export default async function CashHistoryDetailPage(props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const cc = await getCashCountById(id);
    if (!cc) notFound();

    const dateStr = cc.date ? cc.date.toISOString().slice(0, 10) : "";
    const handoverStr = cc.handoverTime ? formatTaipeiDateTime(cc.handoverTime) : "—";
    const cashBox = safeParseDenom(cc.cashBoxJson);
    const reserve = safeParseDenom(cc.reserveJson);
    const sales = safeParseDenom(cc.salesJson);
    const expenses = safeParseExpenses(cc.expensesJson);
    const locationName = cc.location?.name ?? "—";
    const attendantName = cc.attendant?.realName || cc.attendant?.username || "—";

    return (
        <div className="space-y-4 px-4 pb-4 pt-4 md:pt-6 print:space-y-3 print:p-0 print:text-black">
            {/* 列印時的紙張邊界；這個 style 只在這一頁存在，不影響其他頁面的列印 */}
            <style>{`@media print { @page { margin: 12mm; } }`}</style>

            <div className="flex items-center justify-between gap-3 print:hidden">
                <Link href="/cash/history" className={btn("secondary", "md")}>
                    <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    返回列表
                </Link>
                <PrintButton />
            </div>

            <header className="border-b-4 border-double border-stone-800 pb-3 text-center print:pb-2">
                <h1 className="text-2xl font-extrabold text-stone-900 print:text-black">每日現金清點表</h1>
            </header>

            <dl className={cn(CARD, "grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 print:grid-cols-3 print:gap-y-1 print:rounded-none print:border-black print:p-2 print:shadow-none")}>
                <div>
                    <dt className="text-[13px] text-stone-600 print:text-black">日期</dt>
                    <dd className="text-lg font-bold text-stone-900 print:text-base print:text-black">
                        {dateStr ? formatDateWithWeekday(dateStr) : "—"}
                    </dd>
                </div>
                <div>
                    <dt className="text-[13px] text-stone-600 print:text-black">攤位</dt>
                    <dd className="text-lg font-bold text-stone-900 print:text-base print:text-black">{locationName}</dd>
                </div>
                <div>
                    <dt className="text-[13px] text-stone-600 print:text-black">清點人</dt>
                    <dd className="text-lg font-bold text-stone-900 print:text-base print:text-black">{attendantName}</dd>
                </div>
            </dl>

            <DetailTable
                title="錢盒清點"
                denoms={CASH_BOX_DENOMS}
                qtys={cashBox}
                total={cc.cashBoxTotal}
                target={CASH_BOX_TARGET_TOTAL}
            />
            <DetailTable
                title="備用金清點"
                denoms={RESERVE_DENOMS}
                qtys={reserve}
                total={cc.reserveTotal}
                target={RESERVE_TARGET_TOTAL}
            />
            <DetailTable title="當日營業現金" denoms={SALES_DENOMS} qtys={sales} total={cc.salesTotal} target={null} />

            <section className={cn(CARD, "overflow-hidden print:break-inside-avoid print:rounded-none print:border-black print:shadow-none")}>
                <h2 className="border-b border-stone-200 bg-stone-50 px-4 py-3 text-lg font-bold text-stone-900 print:border-black print:bg-white print:px-2 print:py-1 print:text-base print:text-black">
                    當天現金支出明細
                </h2>
                {expenses.length === 0 ? (
                    <p className="px-4 py-4 text-base text-stone-700 print:px-2 print:py-1 print:text-black">這天沒有現金支出。</p>
                ) : (
                    <table className="w-full text-base">
                        <thead className="text-[13px] text-stone-600 print:text-black">
                            <tr className="border-b border-stone-200 print:border-black">
                                <th scope="col" className="px-4 py-2 text-left font-semibold print:px-2 print:py-1">項目</th>
                                <th scope="col" className="px-2 py-2 text-left font-semibold print:py-1">備註</th>
                                <th scope="col" className="px-4 py-2 text-right font-semibold print:px-2 print:py-1">金額</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-200 print:divide-stone-400">
                            {expenses.map((e, i) => (
                                <tr key={i}>
                                    <td className="px-4 py-2.5 font-semibold text-stone-900 print:px-2 print:py-1 print:text-black">{e.item || "—"}</td>
                                    <td className="px-2 py-2.5 text-stone-700 print:py-1 print:text-black">{e.note || ""}</td>
                                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-stone-900 print:px-2 print:py-1 print:text-black">
                                        {e.amount.toLocaleString("en-US")}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3 print:border-black print:bg-white print:px-2 print:py-1">
                    <span className="text-base font-bold text-stone-900 print:text-black">支出合計</span>
                    <span className="text-xl font-extrabold tabular-nums text-stone-900 print:text-base print:text-black">
                        {formatNtd(cc.expensesTotal)}
                    </span>
                </div>
            </section>

            <section
                aria-label="今日營業額"
                className="rounded-2xl border-2 border-stone-800 bg-amber-100 px-5 py-4 print:break-inside-avoid print:rounded-none print:border-4 print:border-double print:bg-white print:py-2"
            >
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-lg font-bold text-stone-900 print:text-black">今日營業額</h2>
                    <p className="text-3xl font-extrabold tabular-nums text-stone-900 print:text-2xl print:text-black">
                        {formatNtd(cc.totalSales)}
                    </p>
                </div>
                <p className="mt-1.5 text-[15px] text-stone-800 print:text-black">
                    營業現金 {formatNtd(cc.salesTotal)} ＋ 當天支出 {formatNtd(cc.expensesTotal)}
                </p>
            </section>

            <section className={cn(CARD, "grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 print:grid-cols-3 print:break-inside-avoid print:gap-2 print:rounded-none print:border-black print:p-2 print:shadow-none")}>
                <div>
                    <h2 className="mb-1 text-[13px] font-semibold text-stone-600 print:text-black">清點人簽名</h2>
                    {cc.signatureDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={cc.signatureDataUrl}
                            alt="清點人簽名"
                            className="h-20 rounded-lg border border-stone-200 bg-white object-contain print:h-16 print:rounded-none print:border-0"
                        />
                    ) : (
                        <p className="text-base text-stone-600 print:text-black">（沒有簽名）</p>
                    )}
                </div>
                <div>
                    <h2 className="mb-1 text-[13px] font-semibold text-stone-600 print:text-black">覆核人</h2>
                    <p className="text-xl font-bold text-stone-900 print:text-base print:text-black">{cc.supervisorName}</p>
                </div>
                <div>
                    <h2 className="mb-1 text-[13px] font-semibold text-stone-600 print:text-black">交班時間</h2>
                    <p className="text-lg font-bold tabular-nums text-stone-900 print:text-base print:text-black">{handoverStr}</p>
                </div>
            </section>

            {cc.checklistDones.length > 0 && (
                <section className={cn(CARD, "overflow-hidden print:break-inside-avoid print:rounded-none print:border-black print:shadow-none")}>
                    <h2 className="border-b border-stone-200 bg-stone-50 px-4 py-3 text-lg font-bold text-stone-900 print:border-black print:bg-white print:px-2 print:py-1 print:text-base print:text-black">
                        動作清點
                    </h2>
                    <ul className="divide-y divide-stone-200 print:divide-stone-400">
                        {cc.checklistDones.map((d) => (
                            <li
                                key={d.id}
                                className={cn(
                                    "flex items-center gap-2.5 px-4 py-3 text-base print:px-2 print:py-1",
                                    d.done ? "text-stone-900" : "bg-red-50 font-semibold text-red-900 print:bg-white print:text-black",
                                )}
                            >
                                {d.done ? (
                                    <CircleCheck className="h-5 w-5 shrink-0 text-emerald-700 print:text-black" aria-hidden="true" />
                                ) : (
                                    <Circle className="h-5 w-5 shrink-0" aria-hidden="true" />
                                )}
                                <span className="flex-1">{d.item?.name ?? "（項目已刪除）"}</span>
                                <span className="text-[15px] font-bold">{d.done ? "已完成" : "未完成"}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {cc.note && (
                <section className={cn(CARD, "p-4 print:break-inside-avoid print:rounded-none print:border-black print:p-2 print:shadow-none")}>
                    <h2 className="mb-1 text-base font-bold text-stone-900 print:text-black">備註</h2>
                    <p className="whitespace-pre-wrap text-base text-stone-800 print:text-black">{cc.note}</p>
                </section>
            )}

            {cc.revenueId && (
                <p className="text-center text-[13px] text-stone-600 print:hidden">
                    已同步到營業額表（編號 <code>{cc.revenueId}</code>）
                </p>
            )}
        </div>
    );
}

function DetailTable({
    title,
    denoms,
    qtys,
    total,
    target,
}: {
    title: string;
    denoms: readonly number[];
    qtys: DenomMap;
    total: number;
    target: number | null;
}) {
    // 已存檔的紀錄：合計 0 也是真的存下來的數字，照實跟目標比
    const status = target === null ? null : diffStatus(total, target, false);
    return (
        <section className={cn(CARD, "overflow-hidden print:break-inside-avoid print:rounded-none print:border-black print:shadow-none")}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-3 print:border-black print:bg-white print:px-2 print:py-1">
                <h2 className="text-lg font-bold text-stone-900 print:text-base print:text-black">
                    {title}
                    {target !== null ? (
                        <span className="ml-2 text-[15px] font-normal text-stone-600 print:text-black">
                            （目標 {target.toLocaleString("en-US")}）
                        </span>
                    ) : null}
                </h2>
                {status ? (
                    <span className="print:hidden"><DiffChip status={status} /></span>
                ) : null}
            </div>
            <table className="w-full text-base">
                <thead className="text-[13px] text-stone-600 print:text-black">
                    <tr className="border-b border-stone-200 print:border-black">
                        <th scope="col" className="px-4 py-2 text-left font-semibold print:px-2 print:py-1">面額</th>
                        <th scope="col" className="px-2 py-2 text-center font-semibold print:py-1">張數</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold print:px-2 print:py-1">金額</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 print:divide-stone-400">
                    {denoms.map((d) => {
                        const qty = qtys[String(d)] ?? 0;
                        return (
                            <tr key={d}>
                                <td className="px-4 py-2.5 font-bold tabular-nums text-stone-900 print:px-2 print:py-1 print:text-black">{d}</td>
                                <td className="px-2 py-2.5 text-center tabular-nums text-stone-900 print:py-1 print:text-black">{qty}</td>
                                <td className="px-4 py-2.5 text-right tabular-nums text-stone-900 print:px-2 print:py-1 print:text-black">
                                    {(d * qty).toLocaleString("en-US")}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="flex items-baseline justify-between gap-3 border-t border-stone-200 bg-stone-50 px-4 py-3 print:border-black print:bg-white print:px-2 print:py-1">
                <span className="text-base font-bold text-stone-900 print:text-black">合計</span>
                <span className="text-xl font-extrabold tabular-nums text-stone-900 print:text-base print:text-black">
                    {formatNtd(total)}
                </span>
            </div>
            {target !== null && total !== target ? (
                <p className="flex items-center gap-1.5 border-t border-stone-200 bg-red-50 px-4 py-2.5 text-[15px] font-bold text-red-900 print:border-black print:bg-white print:px-2 print:py-1 print:text-black">
                    <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    差額 {total - target > 0 ? "+" : ""}
                    {(total - target).toLocaleString("en-US")}
                    （{total - target > 0 ? "比目標多" : "比目標少"} {Math.abs(total - target).toLocaleString("en-US")} 元）
                </p>
            ) : null}
        </section>
    );
}
