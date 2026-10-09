import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePosAccess } from "@/lib/pos-access";
import { getItemLines, hasPosData, kgToCatty, parseIsoDate } from "@/lib/pos-queries";
import { weekdayName } from "@/lib/pos-reports";
import {
    DAY_ITEM_SORTS,
    type DayItemSort,
    type DayMetrics,
    diffPct,
    getComparisons,
    getDayAnomalies,
    getDayHours,
    getDayItems,
    getDayOrders,
    getDayOverview,
    isoToPos,
    nextBusinessDay,
    posToIso,
    prevBusinessDay,
} from "@/lib/pos-day";
import { buildQuery, fmtMoney, fmtNum, fmtSaleTime, parsePage } from "@/lib/pos-format";
import ItemDetail from "../../ItemDetail";
import { numCls, tdCls, thCls } from "../../ui";
import HourChart from "./HourChart";

type SP = { sort?: string; item?: string; ipage?: string };

export default async function DayDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ date: string }>;
    searchParams: Promise<SP>;
}) {
    await requirePosAccess();
    const { date: rawDate } = await params;
    const iso = parseIsoDate(rawDate);
    if (!iso) notFound();
    const sp = await searchParams;
    const sort: DayItemSort = sp.sort && sp.sort in DAY_ITEM_SORTS ? (sp.sort as DayItemSort) : "total";
    const date = isoToPos(iso);
    const selectedItem = (sp.item ?? "").trim().slice(0, 60);
    const itemPage = parsePage(sp.ipage);

    if (!hasPosData()) return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>;

    const overview = getDayOverview(date);
    const prev = prevBusinessDay(date);
    const next = nextBusinessDay(date);
    const nav = (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/pos/daily" className="px-3 py-2 border rounded-md">
                回每日營收
            </Link>
            {prev ? (
                <Link href={`/pos/daily/${posToIso(prev)}`} className="px-3 py-2 border rounded-md">
                    前一天（{prev}）
                </Link>
            ) : (
                <span className="px-3 py-2 border rounded-md opacity-40">前一天</span>
            )}
            {next ? (
                <Link href={`/pos/daily/${posToIso(next)}`} className="px-3 py-2 border rounded-md">
                    後一天（{next}）
                </Link>
            ) : (
                <span className="px-3 py-2 border rounded-md opacity-40">後一天</span>
            )}
        </div>
    );

    if (!overview) {
        return (
            <div className="space-y-4">
                {nav}
                <p className="text-sm text-muted-foreground">{date} 沒有營業資料（可能是公休日，或資料還沒同步）。</p>
            </div>
        );
    }

    const { metrics: m, z } = overview;
    const comparisons = getComparisons(date);
    const items = getDayItems(date, sort);
    const itemData = selectedItem ? getItemLines({ from: iso, to: iso }, selectedItem, itemPage) : null;
    const hours = getDayHours(date);
    const orders = getDayOrders(date);
    const anomalies = getDayAnomalies(date);
    const mismatchOrders = orders.filter((o) => o.mismatch).length;
    const zOk = z.lines.length > 0 ? z.lines.filter((l) => l.match === false).length === 0 : null;
    const zMatchText =
        zOk === null ? "今日尚未日結（或沒有 Z 帳）" : zOk ? "與 Z 帳相符" : "與 Z 帳不符，請到日報（Z 帳）頁看明細";
    const hrs = overview.minutes === null ? "" : `${Math.floor(overview.minutes / 60)} 小時 ${overview.minutes % 60} 分`;

    const sortLink = (s: DayItemSort, label: string) => (
        <Link
            href={`/pos/daily/${iso}${buildQuery({ sort: s, item: selectedItem || undefined })}#item-table`}
            className={sort === s ? "text-primary font-semibold" : "hover:text-foreground"}
        >
            {label}
            {sort === s ? " (排序)" : ""}
        </Link>
    );

    return (
        <div className="space-y-6">
            {nav}
            <h2 className="text-xl font-bold">
                {date}（週{weekdayName(overview.weekday)}）
            </h2>

            <section className="space-y-2" aria-label="當日總覽">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="單數" value={fmtMoney(m.orders)} />
                    <Stat label="營收" value={fmtMoney(m.total)} />
                    <Stat label="平均客單" value={fmtMoney(m.avg)} />
                    <Stat label="秤重品總重量（台斤）" value={fmtNum(m.catty, 1)} />
                </div>
                <div className="rounded-md border p-3 text-sm grid grid-cols-2 gap-y-1 gap-x-4">
                    <div className="text-muted-foreground">第一張單開單</div>
                    <div className="tabular-nums">{overview.firstSale ? fmtSaleTime(overview.firstSale) : "無"}</div>
                    <div className="text-muted-foreground">最後一張單結帳</div>
                    <div className="tabular-nums">{overview.lastClose ? fmtSaleTime(overview.lastClose) : "無"}</div>
                    <div className="text-muted-foreground">營業時長</div>
                    <div>{hrs || "無法計算"}</div>
                    <div className="text-muted-foreground">日結對帳</div>
                    <div
                        className={
                            zOk === null
                                ? "text-sky-600 dark:text-sky-400"
                                : zOk
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400 font-semibold"
                        }
                    >
                        {zMatchText}
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">
                    開單到結帳的時長只計當天開單、當天結帳的單。營業日以 POS 的營業日為準（與 Z 帳一致）。
                </p>
            </section>

            <section className="space-y-2" aria-label="跟誰比">
                <h3 className="text-base font-semibold">跟誰比</h3>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>比較對象</th>
                                <th className={thCls}>單數</th>
                                <th className={thCls}>營收</th>
                                <th className={thCls}>平均客單</th>
                                <th className={thCls}>重量（台斤）</th>
                            </tr>
                        </thead>
                        <tbody>
                            {comparisons.map((c) => (
                                <tr key={c.label} className="border-t align-top">
                                    <td className={tdCls}>
                                        <div>{c.label}</div>
                                        <div className="text-xs text-muted-foreground">{c.note}</div>
                                    </td>
                                    {(["orders", "total", "avg", "catty"] as const).map((k) => (
                                        <td key={k} className={tdCls}>
                                            <Delta cur={m} base={c.base} k={k} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="text-xs text-muted-foreground">每格：比較對象的數字，與今天的差額（今天減對方）及百分比。</p>
            </section>

            <section className="space-y-2" aria-label="品項明細">
                <h3 id="item-table" className="scroll-mt-4 text-base font-semibold">
                    品項明細
                </h3>
                <p className="text-xs text-muted-foreground">點品名可展開當天該品項的每一筆明細。</p>
                {itemData && (
                    <ItemDetail
                        name={selectedItem}
                        lines={itemData.lines}
                        summary={itemData.summary}
                        page={itemPage}
                        closeHref={`/pos/daily/${iso}${buildQuery({ sort })}#item-table`}
                        pagerBase={`/pos/daily/${iso}`}
                        pagerParams={{ sort, item: selectedItem }}
                    />
                )}
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>品名</th>
                                <th className={thCls + " text-right"}>{sortLink("count", "筆數")}</th>
                                <th className={thCls + " text-right"}>{sortLink("qty", "數量")}</th>
                                <th className={thCls + " text-right"}>{sortLink("weight", "重量(台斤)")}</th>
                                <th className={thCls + " text-right"}>{sortLink("total", "營收")}</th>
                                <th className={thCls + " text-right"}>占比</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.rows.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                                        當天沒有品項明細
                                    </td>
                                </tr>
                            )}
                            {items.rows.map((r) => (
                                <tr key={r.name} className={"border-t " + (r.name === selectedItem ? "bg-primary/10" : "")}>
                                    <td className={tdCls}>
                                        <Link
                                            href={`/pos/daily/${iso}${buildQuery({ sort, item: r.name })}#item-detail`}
                                            className="text-primary underline underline-offset-2"
                                        >
                                            {r.name}
                                        </Link>
                                    </td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(r.n)}</td>
                                    <td className={tdCls + " " + numCls}>{fmtNum(r.qty, 2)}</td>
                                    <td className={tdCls + " " + numCls}>{r.kg ? fmtNum(kgToCatty(r.kg), 2) : ""}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                    <td className={tdCls + " " + numCls}>
                                        {items.total ? fmtNum((r.total / items.total) * 100, 1) + "%" : ""}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-2" aria-label="時段分布">
                <h3 className="text-base font-semibold">時段分布</h3>
                <HourChart rows={hours.rows.map((r) => ({ hour: r.hour, orders: r.orders, total: r.total }))} />
            </section>

            <section className="space-y-2" aria-label="異常提示">
                <h3 className="text-base font-semibold">異常提示</h3>
                {anomalies.length === 0 && mismatchOrders === 0 ? (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">當天沒有退貨、作廢、跳號、跨日補結，也沒有金額對不上的單。</p>
                ) : (
                    <ul className="space-y-2">
                        {mismatchOrders > 0 && (
                            <li className="rounded-md border border-red-500/60 p-3 text-sm">
                                <div className="font-semibold text-red-600 dark:text-red-400">金額與明細對不上的單</div>
                                <div className="text-muted-foreground">
                                    {mismatchOrders} 張（在下方單據清單以紅底標示）
                                </div>
                            </li>
                        )}
                        {anomalies.map((a) => (
                            <li key={a.kind} className="rounded-md border border-amber-500/60 p-3 text-sm">
                                <div className="font-semibold text-amber-700 dark:text-amber-300">{a.label}</div>
                                <div className="text-muted-foreground break-words">{a.detail}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="space-y-2" aria-label="當日單據清單">
                <h3 className="text-base font-semibold">當日單據清單（{orders.length} 張）</h3>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>結帳時間</th>
                                <th className={thCls}>單號</th>
                                <th className={thCls + " text-right"}>品項數</th>
                                <th className={thCls + " text-right"}>金額</th>
                                <th className={thCls}>金額與明細</th>
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((o) => (
                                <tr key={o.m_OrderNo} className={"border-t " + (o.mismatch ? "bg-red-500/10" : "")}>
                                    <td className={tdCls + " tabular-nums"}>{fmtSaleTime(o.m_CloseTime ?? o.m_SaleTime)}</td>
                                    <td className={tdCls}>
                                        <Link
                                            href={`/pos/orders/${encodeURIComponent(o.m_OrderNo)}`}
                                            className="text-primary underline underline-offset-2"
                                        >
                                            {o.m_OrderNo}
                                        </Link>
                                    </td>
                                    <td className={tdCls + " " + numCls}>{o.itemCount}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(o.m_Total)}</td>
                                    <td className={tdCls + (o.mismatch ? " text-red-600 dark:text-red-400 font-semibold" : "")}>
                                        {o.mismatch ? `差 ${fmtMoney(o.diff)}` : ""}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{value}</div>
        </div>
    );
}

function Delta({ cur, base, k }: { cur: DayMetrics; base: DayMetrics | null; k: keyof DayMetrics }) {
    if (!base) return <span className="text-muted-foreground">無資料</span>;
    const { diff, pct } = diffPct(cur[k], base[k]);
    const dec = k === "catty" ? 1 : 0;
    const sign = diff > 0 ? "+" : "";
    const cls =
        Math.abs(diff) < 0.5 / Math.pow(10, dec)
            ? "text-muted-foreground"
            : diff > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400";
    return (
        <div className="tabular-nums">
            <div>{k === "catty" ? fmtNum(base[k], 1) : fmtMoney(base[k])}</div>
            <div className={"text-xs " + cls}>
                {sign}
                {k === "catty" ? fmtNum(diff, 1) : fmtMoney(diff)}
                {pct === null ? "" : `（${sign}${fmtNum(pct, 1)}%）`}
            </div>
        </div>
    );
}
