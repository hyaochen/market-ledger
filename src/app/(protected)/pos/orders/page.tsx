import Link from "next/link";
import { resolveRange, searchOrders, hasPosData } from "@/lib/pos-queries";
import { fmtMoney, fmtSaleTime, parsePage } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";
import Pager from "../Pager";

type SP = { from?: string; to?: string; q?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
    const sp = await searchParams;
    const range = resolveRange(sp.from, sp.to, 7);
    const q = (sp.q ?? "").slice(0, 40);
    const page = parsePage(sp.page);
    const data = searchOrders(range, q, page);

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
                <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    單號
                    <input type="text" name="q" defaultValue={q} placeholder="例如 261009A0040" className={fieldCls + " w-44"} />
                </label>
                <button type="submit" className={btnCls}>
                    查詢
                </button>
            </form>
            <p className="text-xs text-muted-foreground">日期欄清空代表不限日期。</p>

            {!hasPosData() ? (
                <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>單號</th>
                                    <th className={thCls}>營業日</th>
                                    <th className={thCls}>開單時間</th>
                                    <th className={thCls + " text-right"}>品項數</th>
                                    <th className={thCls + " text-right"}>總額</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                                            沒有符合的單據
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((o) => (
                                    <tr key={o.m_OrderNo} className="border-t">
                                        <td className={tdCls}>
                                            <Link
                                                href={`/pos/orders/${encodeURIComponent(o.m_OrderNo)}`}
                                                className="text-primary underline underline-offset-2"
                                            >
                                                {o.m_OrderNo}
                                            </Link>
                                        </td>
                                        <td className={tdCls}>{o.m_WorkDate}</td>
                                        <td className={tdCls}>{fmtSaleTime(o.m_SaleTime)}</td>
                                        <td className={tdCls + " " + numCls}>{o.itemCount}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(o.m_Total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager
                        basePath="/pos/orders"
                        params={{ from: range.from ?? "", to: range.to ?? "", q }}
                        page={page}
                        total={data.total}
                    />
                </>
            )}
        </div>
    );
}
