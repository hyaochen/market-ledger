import Link from "next/link";
import { requirePosAccess } from "@/lib/pos-access";
import { getMonthly, listMonths, weekdayName, weekdayOf } from "@/lib/pos-reports";
import { hasPosData } from "@/lib/pos-queries";
import { fmtMoney } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { month?: string };

export default async function MonthlyPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requirePosAccess();
    if (!hasPosData()) return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>;
    const sp = await searchParams;
    const months = listMonths(); // 'YYYY/MM'，新到舊
    const asked = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string).replace("-", "/") : "";
    const month = months.includes(asked) ? asked : months[0];
    if (!month) return <p className="text-sm text-muted-foreground">尚無營業資料。</p>;

    const data = getMonthly(month)!;
    const idx = months.indexOf(month);
    const older = months[idx + 1];
    const newer = months[idx - 1];
    const q = (m: string) => `/pos/monthly?month=${m.replace("/", "-")}`;

    return (
        <div className="space-y-5">
            <form method="get" className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted-foreground flex flex-col gap-1">
                    月份
                    <select name="month" defaultValue={month.replace("/", "-")} className={fieldCls}>
                        {months.map((m) => (
                            <option key={m} value={m.replace("/", "-")}>
                                {m}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="submit" className={btnCls}>
                    查詢
                </button>
                <div className="flex gap-2 text-sm">
                    {older ? (
                        <Link href={q(older)} className="px-3 py-2 border rounded-md">
                            上個月
                        </Link>
                    ) : null}
                    {newer ? (
                        <Link href={q(newer)} className="px-3 py-2 border rounded-md">
                            下個月
                        </Link>
                    ) : null}
                </div>
            </form>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="月合計" value={fmtMoney(data.total)} />
                <Stat label="單數" value={fmtMoney(data.orders)} />
                <Stat label={`營業日數`} value={String(data.openDays)} />
                <Stat label="平均每營業日" value={fmtMoney(data.avgDay)} />
            </div>
            <p className="text-xs text-muted-foreground">平均客單 {fmtMoney(data.avgOrder)}。營業日以 POS 的營業日為準，只計有營業的日子。</p>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">星期幾平均</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>星期</th>
                                <th className={thCls + " text-right"}>本月營業日</th>
                                <th className={thCls + " text-right"}>本月日均營收</th>
                                <th className={thCls + " text-right"}>本月日均單數</th>
                                <th className={thCls + " text-right"}>全期間日均營收</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[1, 2, 3, 4, 5, 6, 0].map((w) => {
                                const m = data.monthStats[w];
                                const a = data.allStats[w];
                                return (
                                    <tr key={w} className="border-t">
                                        <td className={tdCls}>週{weekdayName(w)}</td>
                                        <td className={tdCls + " " + numCls}>{m.days}</td>
                                        <td className={tdCls + " " + numCls}>{m.days ? fmtMoney(m.avgTotal) : ""}</td>
                                        <td className={tdCls + " " + numCls}>{m.days ? fmtMoney(m.avgOrders) : ""}</td>
                                        <td className={tdCls + " " + numCls}>{a.days ? fmtMoney(a.avgTotal) : ""}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">每日趨勢</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>營業日</th>
                                <th className={thCls}>星期</th>
                                <th className={thCls + " text-right"}>單數</th>
                                <th className={thCls + " text-right"}>營收</th>
                                <th className={thCls + " min-w-32"}>趨勢</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.days.map((d) => (
                                <tr key={d.date} className="border-t">
                                    <td className={tdCls}>{d.date}</td>
                                    <td className={tdCls}>週{weekdayName(weekdayOf(d.date))}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(d.orders)}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(d.total)}</td>
                                    <td className="px-2 py-2">
                                        <div className="h-3 w-full rounded bg-muted">
                                            <div
                                                className="h-3 rounded bg-primary"
                                                style={{ width: `${data.maxDayTotal ? (d.total / data.maxDayTotal) * 100 : 0}%` }}
                                            />
                                        </div>
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
