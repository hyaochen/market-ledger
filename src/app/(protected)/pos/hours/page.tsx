import { getHours } from "@/lib/pos-reports";
import { requirePosAccess } from "@/lib/pos-access";
import { hasPosData, resolveRange } from "@/lib/pos-queries";
import { fmtMoney, fmtNum } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { from?: string; to?: string };

export default async function HoursPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requirePosAccess();
    const sp = await searchParams;
    const range = resolveRange(sp.from, sp.to, 30);
    const data = getHours(range);
    const maxTotal = data.rows.reduce((a, r) => Math.max(a, r.total), 0);

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
                <button type="submit" className={btnCls}>
                    查詢
                </button>
            </form>

            {!hasPosData() ? (
                <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        依結帳時間的小時統計；日期以營業日篩選。共 {fmtMoney(data.orders)} 單 /{" "}
                        {fmtMoney(data.total)}
                        {data.noTime > 0 ? `；另有 ${data.noTime} 單沒有結帳時間` : ""}。
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>時段</th>
                                    <th className={thCls + " text-right"}>單數</th>
                                    <th className={thCls + " text-right"}>單數占比</th>
                                    <th className={thCls + " text-right"}>營收</th>
                                    <th className={thCls + " text-right"}>營收占比</th>
                                    <th className={thCls + " text-right"}>客單價</th>
                                    <th className={thCls + " min-w-32"}>營收</th>
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
                                {data.rows.map((r) => (
                                    <tr key={r.hour} className="border-t">
                                        <td className={tdCls}>
                                            {String(r.hour).padStart(2, "0")}:00-{String(r.hour).padStart(2, "0")}:59
                                        </td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.orders)}</td>
                                        <td className={tdCls + " " + numCls}>{fmtNum(r.shareOrders * 100, 1)}%</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                        <td className={tdCls + " " + numCls}>{fmtNum(r.shareTotal * 100, 1)}%</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.avg)}</td>
                                        <td className="px-2 py-2">
                                            <div className="h-3 w-full rounded bg-muted">
                                                <div
                                                    className="h-3 rounded bg-primary"
                                                    style={{ width: `${maxTotal ? (r.total / maxTotal) * 100 : 0}%` }}
                                                />
                                            </div>
                                        </td>
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
