import Link from "next/link";
import { requirePosAccess } from "@/lib/pos-access";
import { getLatestWorkDate, getZDay, getZRange, type ZRangeRow } from "@/lib/pos-reports";
import { parseIsoDate, resolveRange, toPosDate, hasPosData } from "@/lib/pos-queries";
import { buildQuery, fmtMoney } from "@/lib/pos-format";
import { btnCls, fieldCls, numCls, tdCls, thCls } from "../ui";

type SP = { date?: string; from?: string; to?: string; bad?: string };

const STATUS_LABEL: Record<ZRangeRow["status"], { text: string; cls: string }> = {
    match: { text: "相符", cls: "text-emerald-600 dark:text-emerald-400" },
    mismatch: { text: "不符", cls: "text-red-600 dark:text-red-400 font-semibold" },
    pending: { text: "尚未日結", cls: "text-sky-600 dark:text-sky-400" },
    no_z: { text: "無 Z 帳", cls: "text-amber-600 dark:text-amber-400" },
};

export default async function ZReportPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requirePosAccess();
    if (!hasPosData()) return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>;
    const sp = await searchParams;

    const latest = getLatestWorkDate();
    const isoDate = parseIsoDate(sp.date) ?? (latest ? latest.replace(/\//g, "-") : null);
    const day = isoDate ? getZDay(toPosDate(isoDate)) : null;

    const range = resolveRange(sp.from, sp.to, 90);
    const onlyBad = sp.bad === "1";
    const rows = getZRange(range, onlyBad);
    const mismatches = rows.filter((r) => r.status === "mismatch").length;

    return (
        <div className="space-y-6">
            <section className="space-y-3">
                <h2 className="text-base font-semibold">單日 Z 帳</h2>
                <form method="get" className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        營業日
                        <input type="date" name="date" defaultValue={isoDate ?? ""} className={fieldCls} />
                    </label>
                    {/* 保留下方區間清單的條件 */}
                    <input type="hidden" name="from" value={range.from ?? ""} />
                    <input type="hidden" name="to" value={range.to ?? ""} />
                    {onlyBad && <input type="hidden" name="bad" value="1" />}
                    <button type="submit" className={btnCls}>
                        查詢
                    </button>
                </form>

                {day && !day.hasZ && (
                    <p className="text-sm text-muted-foreground">
                        {day.date} 沒有 Z 帳（尚未日結，或當天沒營業）。單據算出：{day.orders.count} 單 / {fmtMoney(day.orders.total)}。
                    </p>
                )}
                {day && day.hasZ && (
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className={thCls}>Z 帳項目</th>
                                    <th className={thCls + " text-right"}>Z 帳數值</th>
                                    <th className={thCls + " text-right"}>單據算出</th>
                                    <th className={thCls}>對帳</th>
                                </tr>
                            </thead>
                            <tbody>
                                {day.lines.map((l, i) => (
                                    <tr key={i} className="border-t">
                                        <td className={tdCls}>{l.name}</td>
                                        <td className={tdCls + " " + numCls}>{l.value}</td>
                                        <td className={tdCls + " " + numCls}>
                                            {l.computed === null ? "" : fmtMoney(l.computed)}
                                        </td>
                                        <td className={tdCls}>
                                            {l.match === null ? (
                                                ""
                                            ) : l.match ? (
                                                <span className="text-emerald-600 dark:text-emerald-400">相符</span>
                                            ) : (
                                                <span className="text-red-600 dark:text-red-400 font-semibold">不符</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {day && day.hasZ && (
                    <p className="text-xs text-muted-foreground">
                        對照欄由銷售單算出：結帳數 = 單數，銷售總額 = 單據總額加總，銷售淨額與營業收入 = 實收加總。
                        其餘項目（折扣、發票號碼等）沒有對照。
                    </p>
                )}
            </section>

            <section className="space-y-3">
                <h2 className="text-base font-semibold">區間對帳清單</h2>
                <form method="get" className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        起日
                        <input type="date" name="from" defaultValue={range.from ?? ""} className={fieldCls} />
                    </label>
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        迄日
                        <input type="date" name="to" defaultValue={range.to ?? ""} className={fieldCls} />
                    </label>
                    <label className="flex h-10 items-center gap-2 text-sm">
                        <input type="checkbox" name="bad" value="1" defaultChecked={onlyBad} className="h-4 w-4" />
                        只看不符
                    </label>
                    <button type="submit" className={btnCls}>
                        查詢
                    </button>
                </form>
                <p className="text-xs text-muted-foreground">
                    共 {rows.length} 天，不符 {mismatches} 天。不符多半是日結後才結帳的跨日補單。
                </p>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>營業日</th>
                                <th className={thCls + " text-right"}>Z 單數</th>
                                <th className={thCls + " text-right"}>單據單數</th>
                                <th className={thCls + " text-right"}>Z 銷售總額</th>
                                <th className={thCls + " text-right"}>單據總額</th>
                                <th className={thCls}>結果</th>
                                <th className={thCls}>說明</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                                        {onlyBad ? "這段期間沒有不符的日子" : "這段期間沒有資料"}
                                    </td>
                                </tr>
                            )}
                            {rows.map((r) => (
                                <tr key={r.date} className="border-t">
                                    <td className={tdCls}>
                                        <Link
                                            href={`/pos/zreport${buildQuery({
                                                date: r.date.replace(/\//g, "-"),
                                                from: range.from ?? "",
                                                to: range.to ?? "",
                                                bad: onlyBad ? "1" : undefined,
                                            })}`}
                                            className="text-primary underline underline-offset-2"
                                        >
                                            {r.date}
                                        </Link>
                                    </td>
                                    <td className={tdCls + " " + numCls}>{r.zCount ?? ""}</td>
                                    <td className={tdCls + " " + numCls}>{r.count}</td>
                                    <td className={tdCls + " " + numCls}>{r.zTotal === null ? "" : fmtMoney(r.zTotal)}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(r.total)}</td>
                                    <td className={tdCls + " " + STATUS_LABEL[r.status].cls}>{STATUS_LABEL[r.status].text}</td>
                                    <td className="px-2 py-2 text-xs text-muted-foreground min-w-48">{r.note}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
