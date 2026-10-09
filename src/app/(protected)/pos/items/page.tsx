import Link from "next/link";
import { ITEM_SORTS, type ItemSort, getItemRanking, hasPosData, kgToCatty, resolveRange } from "@/lib/pos-queries";
import { buildQuery, fmtMoney, fmtNum } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { from?: string; to?: string; sort?: string };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<SP> }) {
    const sp = await searchParams;
    const range = resolveRange(sp.from, sp.to, 30);
    const sort: ItemSort = sp.sort && sp.sort in ITEM_SORTS ? (sp.sort as ItemSort) : "total";
    const data = getItemRanking(range, sort);
    const base = { from: range.from ?? "", to: range.to ?? "" };
    const sortLink = (s: ItemSort, label: string) => (
        <Link
            href={`/pos/items${buildQuery({ ...base, sort: s })}`}
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
                        {data.rows.length >= 500 ? "（僅列前 500）" : ""}。重量單位：1 台斤 = 0.6 公斤。
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>#</th>
                                    <th className={thCls}>品名</th>
                                    <th className={thCls + " text-right"}>{sortLink("total", "銷售額")}</th>
                                    <th className={thCls + " text-right"}>占比</th>
                                    <th className={thCls + " text-right"}>{sortLink("weight", "重量(台斤)")}</th>
                                    <th className={thCls + " text-right"}>重量(公斤)</th>
                                    <th className={thCls + " text-right"}>{sortLink("count", "筆數")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                                            這段期間沒有資料
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((r, idx) => (
                                    <tr key={r.name + idx} className="border-t">
                                        <td className={tdCls}>{idx + 1}</td>
                                        <td className={tdCls}>{r.name}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                        <td className={tdCls + " " + numCls}>
                                            {data.total ? fmtNum((r.total / data.total) * 100, 1) + "%" : ""}
                                        </td>
                                        <td className={tdCls + " " + numCls}>{r.kg ? fmtNum(kgToCatty(r.kg), 1) : ""}</td>
                                        <td className={tdCls + " " + numCls}>{r.kg ? fmtNum(r.kg, 1) : ""}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.n)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
