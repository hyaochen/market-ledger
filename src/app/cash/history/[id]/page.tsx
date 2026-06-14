import { notFound } from "next/navigation";
import Link from "next/link";
import { getCashCountById } from "@/app/actions/cash";

type DenomMap = Record<string, number>;
type ExpenseRow = { item: string; note?: string; amount: number };

function safeParseDenom(json: string): DenomMap {
    try {
        const v = JSON.parse(json);
        if (v && typeof v === "object") return v as DenomMap;
    } catch { /* noop */ }
    return {};
}
function safeParseExpenses(json: string): ExpenseRow[] {
    try {
        const v = JSON.parse(json);
        if (Array.isArray(v)) return v as ExpenseRow[];
    } catch { /* noop */ }
    return [];
}

export default async function CashHistoryDetailPage(props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const cc = await getCashCountById(id);
    if (!cc) notFound();

    const dateStr = cc.date.toISOString().slice(0, 10);
    const handoverStr = cc.handoverTime.toISOString().slice(0, 19).replace("T", " ");
    const cashBox = safeParseDenom(cc.cashBoxJson);
    const reserve = safeParseDenom(cc.reserveJson);
    const sales = safeParseDenom(cc.salesJson);
    const expenses = safeParseExpenses(cc.expensesJson);

    return (
        <div className="p-4 space-y-3 print:p-0">
            <div className="flex items-center justify-between print:hidden">
                <Link href="/cash/history" className="text-sm text-amber-700">&larr; 返回列表</Link>
                <button
                    type="button"
                    onClick={() => window.print()}
                    className="text-sm border border-zinc-400 px-2 py-1 rounded hover:bg-white"
                >
                    列印
                </button>
            </div>

            <h1 className="text-xl font-extrabold text-center border-b-2 border-double border-zinc-800 pb-1">
                每日現金清點表
            </h1>
            <div className="grid grid-cols-3 gap-2 text-sm">
                <div><span className="text-zinc-500">日期：</span><b>{dateStr}</b></div>
                <div><span className="text-zinc-500">攤位：</span><b>{cc.location.name}</b></div>
                <div><span className="text-zinc-500">清點人：</span><b>{cc.attendant.realName || cc.attendant.username}</b></div>
            </div>

            <DetailTable
                title="① 錢盒清點（目標 6,580）"
                rows={[500, 100, 50, 10, 5].map((d) => ({ denom: d, qty: cashBox[String(d)] ?? 0 }))}
                total={cc.cashBoxTotal}
                target={6580}
            />
            <DetailTable
                title="② 備用金清點（目標 7,600）"
                rows={[500, 100, 50, 10, 5].map((d) => ({ denom: d, qty: reserve[String(d)] ?? 0 }))}
                total={cc.reserveTotal}
                target={7600}
            />
            <DetailTable
                title="③ 當日營業現金"
                rows={[1000, 500, 100, 50, 10, 5].map((d) => ({ denom: d, qty: sales[String(d)] ?? 0 }))}
                total={cc.salesTotal}
                target={null}
            />

            <section className="border-2 border-zinc-300 rounded-md overflow-hidden">
                <header className="bg-amber-100 px-3 py-1.5 border-b-2 border-zinc-300 font-bold text-sm">
                    ④ 當天現金支出明細
                </header>
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-xs">
                        <tr>
                            <th className="px-2 py-1 text-left">項目</th>
                            <th className="px-2 py-1 text-left">備註</th>
                            <th className="px-2 py-1 text-right">金額</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                        {expenses.length === 0 && (
                            <tr><td colSpan={3} className="px-2 py-2 text-center text-zinc-400">無</td></tr>
                        )}
                        {expenses.map((e, i) => (
                            <tr key={i}>
                                <td className="px-2 py-1">{e.item || "—"}</td>
                                <td className="px-2 py-1 text-zinc-500">{e.note || ""}</td>
                                <td className="px-2 py-1 text-right font-semibold">{e.amount.toLocaleString()}</td>
                            </tr>
                        ))}
                        <tr className="bg-amber-50/80 font-bold">
                            <td colSpan={2} className="px-2 py-1.5 text-right">支出合計</td>
                            <td className="px-2 py-1.5 text-right text-amber-700">{cc.expensesTotal.toLocaleString()}</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <div className="border-4 border-double border-zinc-800 bg-yellow-50 px-5 py-4 rounded-md flex items-center justify-between">
                <div>
                    <div className="text-base font-bold">今日營業額</div>
                    <div className="text-xs text-zinc-500">＝ 營業現金 ＋ 當天支出</div>
                </div>
                <div className="text-2xl font-extrabold tracking-wider">
                    NT$ {cc.totalSales.toLocaleString()}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="border border-zinc-200 rounded-md p-2 bg-white">
                    <div className="text-zinc-500 mb-1">清點人簽名</div>
                    {cc.signatureDataUrl && (
                        <img src={cc.signatureDataUrl} alt="清點人簽名" className="h-16 object-contain" />
                    )}
                </div>
                <div className="border border-zinc-200 rounded-md p-2 bg-white">
                    <div className="text-zinc-500 mb-1">覆核人</div>
                    <div className="text-base font-bold">{cc.supervisorName}</div>
                </div>
                <div className="border border-zinc-200 rounded-md p-2 bg-white">
                    <div className="text-zinc-500 mb-1">交班時間</div>
                    <div className="font-mono text-sm">{handoverStr}</div>
                </div>
            </div>

            {cc.checklistDones.length > 0 && (
                <section className="border border-zinc-200 rounded-md p-3 bg-white">
                    <div className="font-bold text-sm mb-1">動作清點</div>
                    <ul className="text-sm space-y-0.5">
                        {cc.checklistDones.map((d) => (
                            <li key={d.id} className={d.done ? "text-zinc-900" : "text-red-600"}>
                                {d.done ? "✅" : "⬜"} {d.item.name}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {cc.note && (
                <section className="border border-zinc-200 rounded-md p-3 bg-white">
                    <div className="font-bold text-sm mb-1">備註</div>
                    <p className="text-sm whitespace-pre-wrap">{cc.note}</p>
                </section>
            )}

            {cc.revenueId && (
                <p className="text-xs text-zinc-500 text-center print:hidden">
                    已同步至營業額表（Revenue ID: <code>{cc.revenueId}</code>）
                </p>
            )}
        </div>
    );
}

function DetailTable({
    title,
    rows,
    total,
    target,
}: {
    title: string;
    rows: { denom: number; qty: number }[];
    total: number;
    target: number | null;
}) {
    return (
        <section className="border-2 border-zinc-300 rounded-md overflow-hidden">
            <header className="bg-amber-100 px-3 py-1.5 border-b-2 border-zinc-300 font-bold text-sm">{title}</header>
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs">
                    <tr>
                        <th className="px-2 py-1 text-left">面額</th>
                        <th className="px-2 py-1 text-center">張數</th>
                        <th className="px-2 py-1 text-right">金額</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                    {rows.map((r) => (
                        <tr key={r.denom}>
                            <td className="px-2 py-1 font-bold">{r.denom}</td>
                            <td className="px-2 py-1 text-center">{r.qty}</td>
                            <td className="px-2 py-1 text-right">{(r.denom * r.qty).toLocaleString()}</td>
                        </tr>
                    ))}
                    <tr className="bg-amber-50/80 font-bold">
                        <td colSpan={2} className="px-2 py-1.5 text-right">合計</td>
                        <td className="px-2 py-1.5 text-right text-amber-700">{total.toLocaleString()}</td>
                    </tr>
                    {target !== null && total !== target && (
                        <tr className="bg-red-50 text-xs">
                            <td colSpan={2} className="px-2 py-1 text-right text-red-700">差額</td>
                            <td className="px-2 py-1 text-right font-bold text-red-700">
                                {total - target > 0 ? "+" : ""}{(total - target).toLocaleString()}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </section>
    );
}
