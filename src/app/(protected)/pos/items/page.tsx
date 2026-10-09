import Link from "next/link";
import { requirePosAccess } from "@/lib/pos-access";
import { ITEM_SORTS, type ItemSort, getItemLines, getItemRanking, hasPosData, kgToCatty, resolveRange } from "@/lib/pos-queries";
import { buildQuery, fmtMoney, fmtNum, parsePage } from "@/lib/pos-format";
import ItemDetail from "../ItemDetail";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { from?: string; to?: string; sort?: string; item?: string; ipage?: string };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requirePosAccess();
    const sp = await searchParams;
    const range = resolveRange(sp.from, sp.to, 30);
    const sort: ItemSort = sp.sort && sp.sort in ITEM_SORTS ? (sp.sort as ItemSort) : "total";
    const data = getItemRanking(range, sort);
    const selectedItem = (sp.item ?? "").trim().slice(0, 60);
    const itemPage = parsePage(sp.ipage);
    const itemData = selectedItem ? getItemLines(range, selectedItem, itemPage) : null;
    const base = { from: range.from ?? "", to: range.to ?? "" };
    const maxShare = data.rows.reduce((a, r) => Math.max(a, data.total ? r.total / data.total : 0), 0);
    const sortLink = (s: ItemSort, label: string) => (
        <Link
            href={`/pos/items${buildQuery({ ...base, sort: s, item: selectedItem || undefined })}`}
            className={sort === s ? "text-primary font-semibold" : "hover:text-foreground"}
        >
            {label}
            {sort === s ? " (排序)" : ""}
        </Link>
    );

    return (
        <div className="space-y-4">
            <form method="get" className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    起日
                    <input type="date" name="from" defaultValue={range.from ?? ""} className={fieldCls} />
                </label>
                <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    迄日
                    <input type="date" name="to" defaultValue={range.to ?? ""} className={fieldCls} />
                </label>
                <input type="hidden" name="sort" value={sort} />
                <button type="submit" className={btnCls}>
                    查詢
                </button>
            </form>

            {!hasPosData() ? (
                <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        區間內明細總額 {fmtMoney(data.total)}，共 {data.rows.length} 種品名
                        {data.rows.length >= 500 ? "（僅列前 500）" : ""}。依品名合併（同名但不同編號、不同價格的合併成一列），
                        營收占比以明細總額為分母。重量單位：1 台斤 = 0.6 公斤。
                    </p>
                    {itemData && (
                        <ItemDetail
                            name={selectedItem}
                            lines={itemData.lines}
                            summary={itemData.summary}
                            page={itemPage}
                            closeHref={`/pos/items${buildQuery({ ...base, sort })}`}
                            pagerBase="/pos/items"
                            pagerParams={{ ...base, sort, item: selectedItem }}
                        />
                    )}
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>#</th>
                                    <th className={thCls}>品名</th>
                                    <th className={thCls + " text-right"}>{sortLink("total", "銷售額")}</th>
                                    <th className={thCls + " text-right"}>營收占比</th>
                                    <th className={thCls + " min-w-24"}>占比圖</th>
                                    <th className={thCls + " text-right"}>{sortLink("weight", "重量(台斤)")}</th>
                                    <th className={thCls + " text-right"}>重量(公斤)</th>
                                    <th className={thCls + " text-right"}>{sortLink("count", "筆數")}</th>
                                    <th className={thCls + " text-right"}>單價範圍</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">
                                            這段期間沒有資料
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((r, idx) => {
                                    const share = data.total ? r.total / data.total : 0;
                                    return (
                                        <tr key={r.name + idx} className={"border-t " + (r.name === selectedItem ? "bg-primary/10" : "")}>
                                            <td className={tdCls}>{idx + 1}</td>
                                            <td className={tdCls}>
                                                <Link
                                                    href={`/pos/items${buildQuery({ ...base, sort, item: r.name })}#item-detail`}
                                                    className="text-primary underline underline-offset-2"
                                                >
                                                    {r.name}
                                                </Link>
                                                {r.ids > 1 && (
                                                    <span className="ml-1 rounded bg-muted px-1 text-xs text-muted-foreground">
                                                        合併 {r.ids} 個編號
                                                    </span>
                                                )}
                                            </td>
                                            <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                            <td className={tdCls + " " + numCls}>{fmtNum(share * 100, 1)}%</td>
                                            <td className="px-2 py-2">
                                                <div className="h-2.5 w-full rounded bg-muted">
                                                    <div
                                                        className="h-2.5 rounded bg-primary"
                                                        style={{ width: `${maxShare ? (share / maxShare) * 100 : 0}%` }}
                                                    />
                                                </div>
                                            </td>
                                            <td className={tdCls + " " + numCls}>{r.kg ? fmtNum(kgToCatty(r.kg), 2) : ""}</td>
                                            <td className={tdCls + " " + numCls}>{r.kg ? fmtNum(r.kg, 1) : ""}</td>
                                            <td className={tdCls + " " + numCls}>{fmtMoney(r.n)}</td>
                                            <td className={tdCls + " " + numCls}>
                                                {r.minPrice === r.maxPrice
                                                    ? fmtMoney(r.minPrice)
                                                    : `${fmtMoney(r.minPrice)}-${fmtMoney(r.maxPrice)}`}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
