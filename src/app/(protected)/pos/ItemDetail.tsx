import Link from "next/link";
import { type ItemLine, type ItemLineSummary, kgToCatty } from "@/lib/pos-queries";
import { fmtMoney, fmtNum, fmtSaleTime } from "@/lib/pos-format";
import { numCls, tdCls, thCls } from "./ui";
import Pager from "./Pager";

/** 每台斤價 = 金額 / 台斤；沒秤重（重量 0）的品項不算。 */
export function pricePerCatty(total: number, kg: number): number | null {
    const catty = kgToCatty(kg);
    return catty > 0 ? total / catty : null;
}

export default function ItemDetail({
    name,
    lines,
    summary,
    page,
    closeHref,
    pagerBase,
    pagerParams,
}: {
    name: string;
    lines: ItemLine[];
    summary: ItemLineSummary;
    page: number;
    closeHref: string;
    pagerBase: string;
    pagerParams: Record<string, string | undefined>;
}) {
    const avgPerCatty = pricePerCatty(summary.weightedTotal, summary.weightedKg);
    return (
        <section id="item-detail" className="scroll-mt-4 space-y-2 rounded-md border-2 border-primary/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold">「{name}」的每一筆明細</h3>
                <Link href={closeHref} className="px-3 py-1.5 text-sm border rounded-md">
                    收起明細
                </Link>
            </div>

            {summary.n === 0 ? (
                <p className="text-sm text-muted-foreground">這段期間沒有「{name}」的銷售明細。</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
                        <Mini label="筆數" value={fmtMoney(summary.n)} />
                        <Mini label="總數量" value={fmtNum(summary.qty, 2)} />
                        <Mini
                            label="總重量"
                            value={
                                summary.kg
                                    ? `${fmtNum(kgToCatty(summary.kg), 2)} 台斤（${fmtMoney(summary.kg * 1000)} 公克）`
                                    : "沒有秤重"
                            }
                        />
                        <Mini label="總金額" value={fmtMoney(summary.total)} />
                        <Mini label="平均每台斤價" value={avgPerCatty === null ? "" : fmtNum(avgPerCatty, 1)} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        依品名合併（同名但不同編號的都列進來）。每台斤價 = 金額 / 台斤，只算有秤重的明細，方便看秤重計價有沒有怪的；
                        POS 斤兩是 POS 單據上印的原始算式。
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>結帳時間</th>
                                    <th className={thCls}>單號</th>
                                    <th className={thCls + " text-right"}>數量</th>
                                    <th className={thCls + " text-right"}>重量(台斤)</th>
                                    <th className={thCls + " text-right"}>重量(公克)</th>
                                    <th className={thCls + " text-right"}>單價</th>
                                    <th className={thCls + " text-right"}>金額</th>
                                    <th className={thCls + " text-right"}>每台斤價</th>
                                    <th className={thCls}>POS 斤兩</th>
                                    <th className={thCls}>備註</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((l, idx) => {
                                    const per = pricePerCatty(l.p_Total, l.p_Weight);
                                    return (
                                        <tr
                                            key={`${l.m_OrderNo}-${l.p_serno}-${idx}`}
                                            className={"border-t " + (l.p_Return === 1 ? "bg-red-500/10" : "")}
                                        >
                                            <td className={tdCls + " tabular-nums"}>
                                                {l.m_CloseTime ? l.m_CloseTime.slice(0, 10) + " " : ""}
                                                {fmtSaleTime(l.m_CloseTime ?? l.m_SaleTime)}
                                            </td>
                                            <td className={tdCls}>
                                                <Link
                                                    href={`/pos/orders/${encodeURIComponent(l.m_OrderNo)}`}
                                                    className="text-primary underline underline-offset-2"
                                                >
                                                    {l.m_OrderNo}
                                                </Link>
                                            </td>
                                            <td className={tdCls + " " + numCls}>{fmtNum(l.p_Count, 2)}</td>
                                            <td className={tdCls + " " + numCls}>
                                                {l.p_Weight ? fmtNum(kgToCatty(l.p_Weight), 3) : ""}
                                            </td>
                                            <td className={tdCls + " " + numCls}>
                                                {l.p_Weight ? fmtMoney(l.p_Weight * 1000) : ""}
                                            </td>
                                            <td className={tdCls + " " + numCls}>{fmtMoney(l.p_Price)}</td>
                                            <td className={tdCls + " " + numCls}>{fmtMoney(l.p_Total)}</td>
                                            <td className={tdCls + " " + numCls}>{per === null ? "" : fmtNum(per, 1)}</td>
                                            <td className={tdCls}>{l.p_PriceExpr ?? ""}</td>
                                            <td className={tdCls}>
                                                {l.p_Return === 1 && (
                                                    <span className="rounded bg-destructive/10 px-1 text-xs text-destructive">退貨</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-muted/50 font-semibold">
                                <tr className="border-t-2">
                                    <td className={tdCls} colSpan={2}>
                                        合計（全部 {fmtMoney(summary.n)} 筆）
                                    </td>
                                    <td className={tdCls + " " + numCls}>{fmtNum(summary.qty, 2)}</td>
                                    <td className={tdCls + " " + numCls}>{summary.kg ? fmtNum(kgToCatty(summary.kg), 2) : ""}</td>
                                    <td className={tdCls + " " + numCls}>{summary.kg ? fmtMoney(summary.kg * 1000) : ""}</td>
                                    <td className={tdCls}></td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(summary.total)}</td>
                                    <td className={tdCls + " " + numCls}>{avgPerCatty === null ? "" : fmtNum(avgPerCatty, 1)}</td>
                                    <td className={tdCls}></td>
                                    <td className={tdCls}></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <Pager
                        basePath={pagerBase}
                        params={pagerParams}
                        page={page}
                        total={summary.n}
                        pageParam="ipage"
                        hash="#item-detail"
                    />
                </>
            )}
        </section>
    );
}

function Mini({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border p-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-semibold tabular-nums break-words">{value}</div>
        </div>
    );
}
