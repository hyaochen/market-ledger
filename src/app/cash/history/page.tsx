import Link from "next/link";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { requireCashAuth } from "@/lib/cash-auth";
import prisma from "@/lib/prisma";
import { listCashCounts } from "@/app/actions/cash";
import { countFlags, formatMonthDayWeekday, formatNtd, noteDisplay, resolveLocationFilter, todayLocalIsoDate } from "@/lib/cash-ui";
import { cn } from "@/lib/utils";
import { chip } from "@/components/cash/ui";
import { InfoChip } from "@/components/cash/StatusChip";
import LocationFilter from "@/components/cash/LocationFilter";
import HistoryToolbar from "./HistoryToolbar";

type SearchParams = { from?: string; to?: string; loc?: string };

export default async function CashHistoryPage(props: { searchParams: Promise<SearchParams> }) {
    const user = await requireCashAuth();
    const sp = await props.searchParams;

    // 管理者可以依攤位篩選（員工只看自己的紀錄，不顯示也不套用 loc）
    const locations = user.isAdmin
        ? await prisma.location.findMany({
              where: { tenantId: user.tenantId, isActive: true },
              orderBy: [{ createdAt: "asc" }, { name: "asc" }],
              select: { id: true, name: true },
          })
        : [];
    const locationId = user.isAdmin ? resolveLocationFilter(sp.loc, locations) : undefined;
    const locationName = locations.find((l) => l.id === locationId)?.name;

    const rows = await listCashCounts({ from: sp.from, to: sp.to, locationId });

    return (
        <div className="space-y-4 px-4 pb-4 pt-4 md:pt-6 print:p-0">
            <header>
                <h1 className="text-2xl font-bold text-stone-900">清點歷史</h1>
                <p className="mt-0.5 text-[15px] text-stone-600">
                    {user.isAdmin ? `管理者檢視：${locationName ?? "全部攤位"}` : "僅顯示自己的紀錄"}
                </p>
            </header>

            {user.isAdmin ? (
                <LocationFilter
                    basePath="/cash/history"
                    params={{ from: sp.from, to: sp.to }}
                    locations={locations}
                    selectedId={locationId}
                />
            ) : null}

            <HistoryToolbar
                defaultFrom={sp.from}
                defaultTo={sp.to}
                isAdmin={user.isAdmin}
                today={todayLocalIsoDate()}
            />

            {rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-10 text-center">
                    <p className="text-lg font-bold text-stone-900">這個條件下還沒有清點紀錄</p>
                    <p className="mt-1 text-base text-stone-600">換一個日期範圍看看，或先去「新增清點」。</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {rows.map((r) => {
                        const dateStr = r.date ? r.date.toISOString().slice(0, 10) : "";
                        const locationName = r.location?.name ?? "—";
                        const attendantName = r.attendant?.realName || r.attendant?.username || "—";
                        const flags = countFlags(r.cashBoxTotal, r.reserveTotal);
                        const note = noteDisplay(r.note);
                        return (
                            <li key={r.id} className="print:break-inside-avoid">
                                <Link
                                    href={`/cash/history/${r.id}`}
                                    className="block rounded-2xl border border-stone-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:border-amber-500 active:bg-stone-50 motion-reduce:transition-none print:rounded-none print:border-black print:shadow-none"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-lg font-bold text-stone-900">
                                            {dateStr ? formatMonthDayWeekday(dateStr) : "—"}
                                        </p>
                                        <p className="shrink-0 text-xl font-extrabold tabular-nums text-stone-900">
                                            {formatNtd(r.totalSales)}
                                        </p>
                                    </div>

                                    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                                        <span className={chip("warn", "px-2.5 py-0.5 text-[13px]")}>{locationName}</span>
                                        <span className="text-[15px] text-stone-700">{attendantName}</span>
                                        {dateStr ? (
                                            <span className="text-[13px] text-stone-600">{dateStr.slice(0, 4)} 年</span>
                                        ) : null}
                                    </div>

                                    {/* 備註一律顯示：有填是內容（單行、過長以省略號截斷，整段在詳情頁），沒填是「無」。列印時改成折行完整印出 */}
                                    <p className="mt-1.5 flex min-w-0 text-[15px] leading-snug print:text-black">
                                        <span className="shrink-0 text-stone-600 print:text-black">備註：</span>
                                        <span
                                            className={cn(
                                                "min-w-0 flex-1 truncate print:overflow-visible print:whitespace-pre-wrap print:break-words print:text-black",
                                                note.isEmpty ? "text-stone-700" : "text-stone-800",
                                            )}
                                        >
                                            {note.text}
                                        </span>
                                    </p>

                                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-stone-100 pt-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {flags.length === 0 ? (
                                                <InfoChip tone="ok" icon={CircleCheck}>正常</InfoChip>
                                            ) : (
                                                flags.map((f) => (
                                                    <InfoChip key={f.kind} tone="bad" icon={TriangleAlert}>
                                                        {f.label}
                                                    </InfoChip>
                                                ))
                                            )}
                                        </div>
                                        <ChevronRight className="h-5 w-5 shrink-0 text-stone-500 print:hidden" aria-hidden="true" />
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
