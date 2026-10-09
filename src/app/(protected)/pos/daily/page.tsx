import { resolveRange, getRevenue, hasPosData } from "@/lib/pos-queries";
import { fmtMoney } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { from?: string; to?: string; by?: string };

export default async function DailyPage({ searchParams }: { searchParams: Promise<SP> }) {
    const sp = await searchParams;
    const range = resolveRange(sp.from, sp.to, 30);
    const by = sp.by === "month" ? "month" : "day";
    const data = getRevenue(range, by);

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
                    彙總
                    <select name="by" defaultValue={by} className={fieldCls}>
                        <option value="day">按日</option>
                        <option value="month">按月</option>
                    </select>
                </label>
                <button type="submit" className={btnCls}>
                    查詢
                </button>
            </form>

            {!hasPosData() ? (
                <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2">
                        <Stat label="單數" value={fmtMoney(data.orders)} />
                        <Stat label="總額" value={fmtMoney(data.total)} />
                        <Stat label="平均客單" value={fmtMoney(data.avg)} />
                    </div>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>{by === "month" ? "月份" : "營業日"}</th>
                                    <th className={thCls + " text-right"}>單數</th>
                                    <th className={thCls + " text-right"}>總額</th>
                                    <th className={thCls + " text-right"}>平均客單</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                                            這段期間沒有資料
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((r) => (
                                    <tr key={r.key} className="border-t">
                                        <td className={tdCls}>{r.key}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.orders)}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                        <td className={tdCls + " " + numCls}>{fmtMoney(r.avg)}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg font-semibold tabular-nums">{value}</div>
        </div>
    );
}
