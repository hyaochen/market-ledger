import Link from "next/link";
import { listCashAlerts } from "@/app/actions/cash";

export default async function CashAlertsPage() {
    const alerts = await listCashAlerts();

    const grouped = {
        diff: alerts.filter((a) => a.type === "diff"),
        checklist: alerts.filter((a) => a.type === "checklist"),
        missing: alerts.filter((a) => a.type === "missing"),
    };

    return (
        <div className="p-4 space-y-4">
            <h1 className="text-lg font-bold">⚠ 異常清單</h1>

            <AlertSection title={`錢盒/備用金差額未平 (${grouped.diff.length})`} alerts={grouped.diff} colorClass="text-red-700 bg-red-50 border-red-200" />
            <AlertSection title={`動作未全部打勾 (${grouped.checklist.length})`} alerts={grouped.checklist} colorClass="text-amber-700 bg-amber-50 border-amber-200" />
            <AlertSection title={`整天缺漏清點 (${grouped.missing.length})`} alerts={grouped.missing} colorClass="text-zinc-700 bg-zinc-50 border-zinc-200" />

            {alerts.length === 0 && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
                    ✓ 近 90 天沒有任何異常。
                </p>
            )}
        </div>
    );
}

function AlertSection({
    title,
    alerts,
    colorClass,
}: {
    title: string;
    alerts: { type: string; date: string; locationName: string | null; detail: string; cashCountId?: string }[];
    colorClass: string;
}) {
    if (alerts.length === 0) return null;
    return (
        <section className="space-y-1">
            <h2 className="text-sm font-bold">{title}</h2>
            <ul className={`border rounded-md ${colorClass}`}>
                {alerts.map((a, i) => (
                    <li key={`${a.type}-${a.date}-${i}`} className="px-3 py-1.5 border-b last:border-b-0 border-zinc-200/40 flex items-center justify-between text-sm">
                        <div className="min-w-0">
                            <span className="font-mono text-xs mr-2">{a.date}</span>
                            {a.locationName && <span className="mr-2">{a.locationName}</span>}
                            <span>{a.detail}</span>
                        </div>
                        {a.cashCountId && (
                            <Link href={`/cash/history/${a.cashCountId}`} className="text-xs underline shrink-0">查看</Link>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
