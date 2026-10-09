import { getHealth, type HealthStatus } from "@/lib/pos-reports";
import { requirePosAccess } from "@/lib/pos-access";
import { addDays, getRevenue, hasPosData, taipeiToday } from "@/lib/pos-queries";
import { fmtMoney } from "@/lib/pos-format";
import { tableLabel } from "@/lib/pos-labels";
import { numCls, tdCls, thCls } from "./ui";

const BADGE: Record<HealthStatus, { text: string; cls: string }> = {
    pass: { text: "通過", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    attention: { text: "注意", cls: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
    pending: { text: "待日結", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
    info: { text: "資訊", cls: "bg-muted text-muted-foreground" },
};

export default async function PosOverviewPage() {
    await requirePosAccess();
    if (!hasPosData()) {
        return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。按上方「立即同步」或等每小時自動同步。</p>;
    }
    const health = getHealth();
    if (!health) return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>;

    const recent = getRevenue({ from: addDays(taipeiToday(), -6), to: taipeiToday() }, "day");

    return (
        <div className="space-y-5">
            <section className="space-y-2" aria-label="資料健康列">
                <h2 className="text-base font-semibold">
                    資料健康列<span className="ml-2 text-sm font-normal text-muted-foreground">營業日 {health.workDate}</span>
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                    {health.checks.map((c) => (
                        <div key={c.key} className="rounded-md border p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">{c.label}</span>
                                <span className={"rounded px-1.5 py-0.5 text-xs font-medium " + BADGE[c.status].cls}>
                                    {BADGE[c.status].text}
                                </span>
                            </div>
                            <div className="text-base font-semibold tabular-nums break-words">{c.value}</div>
                            {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
                        </div>
                    ))}
                </div>
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">各主要表筆數</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>資料表</th>
                                <th className={thCls + " text-right"}>筆數</th>
                            </tr>
                        </thead>
                        <tbody>
                            {health.tables.map((t) => (
                                <tr key={t.table} className="border-t">
                                    <td className={tdCls}>{tableLabel(t.table)}</td>
                                    <td className={tdCls + " " + numCls}>{fmtMoney(t.rows)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-2">
                <h2 className="text-base font-semibold">近 7 日</h2>
                <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className={thCls}>營業日</th>
                                <th className={thCls + " text-right"}>單數</th>
                                <th className={thCls + " text-right"}>總額</th>
                                <th className={thCls + " text-right"}>平均客單</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recent.rows.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                                        近 7 日沒有資料
                                    </td>
                                </tr>
                            )}
                            {recent.rows.map((r) => (
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
            </section>
        </div>
    );
}
