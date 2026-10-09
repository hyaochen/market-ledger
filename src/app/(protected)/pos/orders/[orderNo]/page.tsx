import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail, kgToCatty } from "@/lib/pos-queries";
import { fmtMoney, fmtNum } from "@/lib/pos-format";
import { numCls, tdCls, thCls } from "../../ui";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNo: string }> }) {
    const { orderNo: raw } = await params;
    let orderNo = raw;
    try {
        orderNo = decodeURIComponent(raw);
    } catch {
        notFound();
    }
    const detail = getOrderDetail(orderNo);
    if (!detail) notFound();
    const { order, items, checks } = detail;

    return (
        <div className="space-y-4">
            <Link href="/pos/orders" className="text-sm text-primary underline underline-offset-2">
                回到單據查詢
            </Link>

            <div className="rounded-md border p-3 text-sm grid grid-cols-2 gap-y-1 gap-x-4">
                <div className="text-muted-foreground">單號</div>
                <div className="font-medium">{order.m_OrderNo}</div>
                <div className="text-muted-foreground">營業日</div>
                <div>{order.m_WorkDate}</div>
                <div className="text-muted-foreground">開單時間</div>
                <div>{order.m_SaleTime}</div>
                <div className="text-muted-foreground">結帳</div>
                <div>{order.m_Checkout === 1 ? "已結帳" : "未結帳"}</div>
                <div className="text-muted-foreground">單據總額</div>
                <div className="font-semibold tabular-nums">{fmtMoney(order.m_Total)}</div>
            </div>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">明細</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>#</th>
                                <th className={thCls}>品名</th>
                                <th className={thCls + " text-right"}>數量</th>
                                <th className={thCls + " text-right"}>台斤</th>
                                <th className={thCls + " text-right"}>公斤</th>
                                <th className={thCls + " text-right"}>單價</th>
                                <th className={thCls + " text-right"}>小計</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                                        沒有明細
                                    </td>
                                </tr>
                            )}
                            {items.map((i) => (
                                <tr key={i.p_serno} className="border-t">
                                    <td className={tdCls}>{i.p_serno}</td>
                                    <td className={tdCls}>
                                        {i.p_FoodName}
                                        {i.p_Return === 1 && (
                                            <span className="ml-1 rounded bg-destructive/10 px-1 text-xs text-destructive">
                                                退貨
                                            </span>
                                        )}
                                    </td>
                                    <td className={tdCls + " " + numCls}>{fmtNum(i.p_Count)}</td>
                                    <td className={tdCls + " " + numCls}>
                                        {i.p_Weight ? fmtNum(kgToCatty(i.p_Weight), 3) : ""}
                                    </td>
                                    <td className={tdCls + " " + numCls}>{i.p_Weight ? fmtNum(i.p_Weight, 3) : ""}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(i.p_Price)}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(i.p_Total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">付款</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>#</th>
                                <th className={thCls}>付款方式</th>
                                <th className={thCls + " text-right"}>金額</th>
                            </tr>
                        </thead>
                        <tbody>
                            {checks.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">
                                        沒有付款紀錄
                                    </td>
                                </tr>
                            )}
                            {checks.map((c) => (
                                <tr key={c.c_serNO} className="border-t">
                                    <td className={tdCls}>{c.c_serNO}</td>
                                    <td className={tdCls}>{c.c_KindName}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(c.c_Total)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
