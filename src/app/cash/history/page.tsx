import Link from "next/link";
import { requireCashAuth } from "@/lib/cash-auth";
import { listCashCounts } from "@/app/actions/cash";
import HistoryToolbar from "./HistoryToolbar";

type SearchParams = { from?: string; to?: string };

export default async function CashHistoryPage(props: { searchParams: Promise<SearchParams> }) {
    const user = await requireCashAuth();
    const sp = await props.searchParams;
    const rows = await listCashCounts({ from: sp.from, to: sp.to });

    return (
        <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold">📜 清點歷史</h1>
                <span className="text-xs text-zinc-500">
                    {user.isAdmin ? `${user.displayName}（admin 看全部）` : `${user.displayName}（僅顯示自己）`}
                </span>
            </div>
            <HistoryToolbar defaultFrom={sp.from} defaultTo={sp.to} isAdmin={user.isAdmin} />

            {rows.length === 0 ? (
                <p className="text-sm text-zinc-500 py-6 text-center">尚無清點紀錄。</p>
            ) : (
                <ul className="divide-y divide-zinc-200 border border-zinc-200 rounded-md bg-white">
                    {rows.map((r) => {
                        const dateStr = r.date ? r.date.toISOString().slice(0, 10) : "—";
                        const locationName = r.location?.name ?? "—";
                        const attendantName = r.attendant?.realName || r.attendant?.username || "—";
                        const cashBoxOk = r.cashBoxTotal === 6580;
                        const reserveOk = r.reserveTotal === 7600;
                        const flags: string[] = [];
                        if (!cashBoxOk) flags.push(`錢盒${r.cashBoxTotal - 6580 > 0 ? "+" : ""}${r.cashBoxTotal - 6580}`);
                        if (!reserveOk) flags.push(`備用金${r.reserveTotal - 7600 > 0 ? "+" : ""}${r.reserveTotal - 7600}`);
                        return (
                            <li key={r.id}>
                                <Link
                                    href={`/cash/history/${r.id}`}
                                    className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-amber-50"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-semibold">{dateStr} · {locationName}</div>
                                        <div className="text-xs text-zinc-500 truncate">
                                            {attendantName}
                                            {flags.length > 0 && (
                                                <span className="ml-2 text-red-600">⚠ {flags.join("、")}</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-base font-bold text-amber-700">
                                            NT$ {r.totalSales.toLocaleString()}
                                        </div>
                                        <div className="text-[10px] text-zinc-400">
                                            收 {r.salesTotal.toLocaleString()} / 支 {r.expensesTotal.toLocaleString()}
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
