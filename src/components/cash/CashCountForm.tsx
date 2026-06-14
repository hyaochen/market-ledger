"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SignaturePad from "./SignaturePad";
import { submitCashCount } from "@/app/actions/cash";

type ChecklistItemDef = {
    id: string;
    name: string;
};

type Props = {
    today: string; // YYYY-MM-DD
    attendantId: string;
    attendantName: string;
    locationName: string;
    checklistItems: ChecklistItemDef[];
};

const CASH_BOX_DENOMS = [500, 100, 50, 10, 5] as const;
const CASH_BOX_TARGET_QTY: Record<number, number> = { 500: 5, 100: 26, 50: 19, 10: 43, 5: 20 };
const CASH_BOX_TARGET_TOTAL = 6580;

const RESERVE_DENOMS = [500, 100, 50, 10, 5] as const;
const RESERVE_TARGET_QTY: Record<number, number> = { 500: 5, 100: 30, 50: 20, 10: 100, 5: 20 };
const RESERVE_TARGET_TOTAL = 7600;

const SALES_DENOMS = [1000, 500, 100, 50, 10, 5] as const;

const INITIAL_EXPENSE_ROWS = 6;

const DRAFT_SCHEMA_VERSION = 1;

type ExpenseRow = { item: string; note: string; amount: string };

type DraftPayload = {
    v: number;
    cashBox: Record<string, string>;
    reserve: Record<string, string>;
    sales: Record<string, string>;
    expenses: ExpenseRow[];
    checkedIds: string[];
    signature: string | null;
    note: string;
    savedAt: number;
};

function emptyDenomState(denoms: readonly number[]): Record<string, string> {
    return Object.fromEntries(denoms.map((d) => [String(d), ""])) as Record<string, string>;
}

function emptyExpenses(): ExpenseRow[] {
    return Array.from({ length: INITIAL_EXPENSE_ROWS }, () => ({ item: "", note: "", amount: "" }));
}

function toNumberMap(map: Record<string, string>): Record<string, number> {
    return Object.fromEntries(Object.entries(map).map(([d, v]) => [d, Number(v) || 0]));
}

function sumDenoms(map: Record<string, string>): number {
    return Object.entries(map).reduce((acc, [d, v]) => acc + (Number(d) * (Number(v) || 0)), 0);
}

function ntFormat(n: number): string {
    if (!Number.isFinite(n) || n === 0) return "—";
    return "NT$ " + n.toLocaleString("zh-Hant-TW");
}

function draftKey(attendantId: string, date: string) {
    return `cashcount-draft:${attendantId}:${date}`;
}

function readDraft(key: string): DraftPayload | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DraftPayload;
        if (!parsed || parsed.v !== DRAFT_SCHEMA_VERSION) return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeDraft(key: string, payload: DraftPayload) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // quota / private mode — silently skip
    }
}

function clearDraft(key: string) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
}

function draftHasContent(p: DraftPayload): boolean {
    if (p.signature) return true;
    if (p.note.trim().length > 0) return true;
    if (p.checkedIds.length > 0) return true;
    if (Object.values(p.cashBox).some((v) => v && Number(v) > 0)) return true;
    if (Object.values(p.reserve).some((v) => v && Number(v) > 0)) return true;
    if (Object.values(p.sales).some((v) => v && Number(v) > 0)) return true;
    if (p.expenses.some((r) => r.item.trim() || r.note.trim() || (Number(r.amount) || 0) > 0)) return true;
    return false;
}

export default function CashCountForm({ today, attendantId, attendantName, locationName, checklistItems }: Props) {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<"cash" | "checklist">("cash");
    const [cashBox, setCashBox] = useState<Record<string, string>>(emptyDenomState(CASH_BOX_DENOMS));
    const [reserve, setReserve] = useState<Record<string, string>>(emptyDenomState(RESERVE_DENOMS));
    const [sales, setSales] = useState<Record<string, string>>(emptyDenomState(SALES_DENOMS));
    const [expenses, setExpenses] = useState<ExpenseRow[]>(emptyExpenses);
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
    const [signature, setSignature] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [restoredAt, setRestoredAt] = useState<number | null>(null);
    const [isPending, startTransition] = useTransition();

    const key = useMemo(() => draftKey(attendantId, today), [attendantId, today]);
    const hasHydratedRef = useRef(false);
    const submittedRef = useRef(false);

    // 1. Mount 後從 sessionStorage 還原
    useEffect(() => {
        const draft = readDraft(key);
        if (draft && draftHasContent(draft)) {
            setCashBox({ ...emptyDenomState(CASH_BOX_DENOMS), ...draft.cashBox });
            setReserve({ ...emptyDenomState(RESERVE_DENOMS), ...draft.reserve });
            setSales({ ...emptyDenomState(SALES_DENOMS), ...draft.sales });
            if (Array.isArray(draft.expenses) && draft.expenses.length > 0) {
                setExpenses(draft.expenses);
            }
            setCheckedIds(new Set(draft.checkedIds));
            setSignature(draft.signature);
            setNote(draft.note);
            setRestoredAt(draft.savedAt);
        }
        hasHydratedRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    // 2. 任何欄位變動 → debounced 寫入 sessionStorage
    useEffect(() => {
        if (!hasHydratedRef.current) return;
        if (submittedRef.current) return;
        const payload: DraftPayload = {
            v: DRAFT_SCHEMA_VERSION,
            cashBox,
            reserve,
            sales,
            expenses,
            checkedIds: Array.from(checkedIds),
            signature,
            note,
            savedAt: Date.now(),
        };
        const isEmpty = !draftHasContent(payload);
        const t = window.setTimeout(() => {
            if (isEmpty) {
                clearDraft(key);
            } else {
                writeDraft(key, payload);
            }
        }, 300);
        return () => window.clearTimeout(t);
    }, [key, cashBox, reserve, sales, expenses, checkedIds, signature, note]);

    // 3. beforeunload guard
    const hasDirty = useMemo(() => {
        return (
            !!signature ||
            note.trim().length > 0 ||
            checkedIds.size > 0 ||
            Object.values(cashBox).some((v) => v && Number(v) > 0) ||
            Object.values(reserve).some((v) => v && Number(v) > 0) ||
            Object.values(sales).some((v) => v && Number(v) > 0) ||
            expenses.some((r) => r.item.trim() || r.note.trim() || (Number(r.amount) || 0) > 0)
        );
    }, [signature, note, checkedIds, cashBox, reserve, sales, expenses]);

    useEffect(() => {
        function handler(e: BeforeUnloadEvent) {
            if (!hasDirty || submittedRef.current) return;
            e.preventDefault();
            e.returnValue = "";
        }
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasDirty]);

    const cashBoxTotal = useMemo(() => sumDenoms(cashBox), [cashBox]);
    const reserveTotal = useMemo(() => sumDenoms(reserve), [reserve]);
    const salesTotal = useMemo(() => sumDenoms(sales), [sales]);
    const expensesTotal = useMemo(
        () => expenses.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
        [expenses],
    );
    const totalSales = salesTotal + expensesTotal;

    const cashBoxDiff = cashBoxTotal === 0 ? null : cashBoxTotal - CASH_BOX_TARGET_TOTAL;
    const reserveDiff = reserveTotal === 0 ? null : reserveTotal - RESERVE_TARGET_TOTAL;

    function updateExpense(i: number, k: keyof ExpenseRow, v: string) {
        setExpenses((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    }

    function addExpenseRow() {
        setExpenses((prev) => [...prev, { item: "", note: "", amount: "" }]);
    }

    function toggleCheck(id: string) {
        setCheckedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function handleDiscardDraft() {
        if (!window.confirm("確定要丟棄已自動還原的草稿？本表單會清空。")) return;
        setCashBox(emptyDenomState(CASH_BOX_DENOMS));
        setReserve(emptyDenomState(RESERVE_DENOMS));
        setSales(emptyDenomState(SALES_DENOMS));
        setExpenses(emptyExpenses());
        setCheckedIds(new Set());
        setSignature(null);
        setNote("");
        clearDraft(key);
        setRestoredAt(null);
    }

    function handleSubmit() {
        setError(null);
        setSuccess(null);

        if (!signature) {
            setError("請先簽名再提交。");
            setActiveTab("cash");
            return;
        }
        if (totalSales <= 0) {
            setError("今日營業額為 0，請確認金額或聯絡管理員。");
            return;
        }

        startTransition(async () => {
            const res = await submitCashCount({
                date: today,
                cashBox: toNumberMap(cashBox),
                reserve: toNumberMap(reserve),
                sales: toNumberMap(sales),
                expenses: expenses.map((r) => ({
                    item: r.item.trim(),
                    note: r.note.trim(),
                    amount: Number(r.amount) || 0,
                })),
                checklistDone: checklistItems.map((c) => ({ id: c.id, done: checkedIds.has(c.id) })),
                signatureDataUrl: signature,
                note: note.trim(),
            });
            if (!res.success) {
                setError(res.error || "儲存失敗");
                return;
            }
            submittedRef.current = true;
            clearDraft(key);
            setSuccess(`✅ 已儲存（今日營業額 NT$ ${totalSales.toLocaleString()}），同步寫入 Revenue。`);
            router.refresh();
            setTimeout(() => router.push("/cash/history"), 1200);
        });
    }

    return (
        <div className="p-4 space-y-4">
            {/* 草稿還原 toast */}
            {restoredAt !== null && (
                <div className="bg-sky-50 border border-sky-300 text-sky-900 rounded-md p-3 text-sm flex items-start justify-between gap-3">
                    <div className="flex-1">
                        <div className="font-semibold">📋 找到上次未完成的清點，已自動還原</div>
                        <div className="text-xs text-sky-700 mt-0.5">
                            儲存時間：{new Date(restoredAt).toLocaleString("zh-Hant-TW")}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleDiscardDraft}
                        className="px-3 py-1.5 bg-white border border-sky-400 text-sky-700 rounded-md text-xs font-semibold whitespace-nowrap"
                    >
                        丟棄草稿
                    </button>
                </div>
            )}

            {/* 表頭 */}
            <div className="bg-amber-100 border border-amber-300 rounded-md p-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <div className="text-zinc-600 text-xs">日期</div>
                        <div className="font-bold">{today}</div>
                    </div>
                    <div>
                        <div className="text-zinc-600 text-xs">攤位</div>
                        <div className="font-bold">{locationName}</div>
                    </div>
                    <div>
                        <div className="text-zinc-600 text-xs">清點人</div>
                        <div className="font-bold">{attendantName}</div>
                    </div>
                </div>
                <div className="mt-1 text-xs text-zinc-500">覆核人：洪怜俼（自動）</div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-300">
                <TabButton active={activeTab === "cash"} onClick={() => setActiveTab("cash")}>
                    ① 現金清點
                </TabButton>
                <TabButton active={activeTab === "checklist"} onClick={() => setActiveTab("checklist")}>
                    ② 動作清點（{checkedIds.size}/{checklistItems.length}）
                </TabButton>
            </div>

            {activeTab === "cash" && (
                <div className="space-y-4">
                    <DenomTable
                        title="① 錢盒清點"
                        subtitle={`目標 NT$ 6,580（面額張數固定）`}
                        denoms={[...CASH_BOX_DENOMS]}
                        targetQty={CASH_BOX_TARGET_QTY}
                        values={cashBox}
                        onChange={(d, v) => setCashBox((p) => ({ ...p, [d]: v }))}
                        total={cashBoxTotal}
                        diff={cashBoxDiff}
                    />

                    <DenomTable
                        title="② 備用金清點"
                        subtitle={`目標 NT$ 7,600（總額固定）`}
                        denoms={[...RESERVE_DENOMS]}
                        targetQty={RESERVE_TARGET_QTY}
                        values={reserve}
                        onChange={(d, v) => setReserve((p) => ({ ...p, [d]: v }))}
                        total={reserveTotal}
                        diff={reserveDiff}
                    />

                    <DenomTable
                        title="③ 當日營業現金"
                        subtitle="扣回錢盒 6,580 / 備用金 7,600 後剩下的現金"
                        denoms={[...SALES_DENOMS]}
                        targetQty={null}
                        values={sales}
                        onChange={(d, v) => setSales((p) => ({ ...p, [d]: v }))}
                        total={salesTotal}
                        diff={null}
                    />

                    <section className="border-2 border-zinc-300 rounded-md overflow-hidden">
                        <header className="bg-amber-100 px-3 py-2 border-b-2 border-zinc-300 flex items-center justify-between">
                            <h3 className="font-bold text-sm">④ 當天現金支出明細</h3>
                            <button
                                type="button"
                                onClick={addExpenseRow}
                                className="text-xs text-amber-700 underline"
                            >
                                + 新增一列
                            </button>
                        </header>
                        <div className="bg-amber-50/60 px-3 py-1 text-xs text-zinc-600 border-b border-zinc-200">
                            從錢盒/營業現金支付的項目（進貨、零工、雜支）寫完自動加總。
                        </div>
                        <div className="divide-y divide-zinc-200">
                            {expenses.map((row, i) => (
                                <div key={i} className="grid grid-cols-12 gap-2 px-2 py-1.5 items-center">
                                    <input
                                        type="text"
                                        placeholder="項目"
                                        value={row.item}
                                        onChange={(e) => updateExpense(i, "item", e.target.value)}
                                        className="col-span-5 border-b border-dashed border-zinc-400 px-1 py-1 text-sm bg-transparent focus:outline-none focus:border-amber-600"
                                    />
                                    <input
                                        type="text"
                                        placeholder="備註"
                                        value={row.note}
                                        onChange={(e) => updateExpense(i, "note", e.target.value)}
                                        className="col-span-4 border-b border-dashed border-zinc-400 px-1 py-1 text-sm bg-transparent focus:outline-none focus:border-amber-600"
                                    />
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min="0"
                                        placeholder="金額"
                                        value={row.amount}
                                        onChange={(e) => updateExpense(i, "amount", e.target.value)}
                                        className="col-span-3 border-b border-dashed border-zinc-400 px-1 py-1 text-sm text-right font-bold bg-transparent focus:outline-none focus:border-amber-600"
                                    />
                                </div>
                            ))}
                            <div className="px-3 py-2 bg-amber-100/80 flex justify-between items-center text-sm font-bold">
                                <span>支出合計</span>
                                <span className="text-amber-700">{ntFormat(expensesTotal)}</span>
                            </div>
                        </div>
                    </section>

                    <div className="border-4 border-double border-zinc-800 bg-yellow-50 px-5 py-4 rounded-md flex items-center justify-between">
                        <div>
                            <div className="text-base font-bold">今日營業額</div>
                            <div className="text-xs text-zinc-500">＝ 營業現金 ＋ 當天支出</div>
                        </div>
                        <div className="text-2xl font-extrabold tracking-wider">
                            {totalSales > 0 ? `NT$ ${totalSales.toLocaleString()}` : "—"}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === "checklist" && (
                <div className="space-y-3">
                    <h3 className="font-bold text-sm">② 動作清點</h3>
                    {checklistItems.length === 0 ? (
                        <p className="text-sm text-zinc-500">尚無動作項目，請聯絡管理員設定。</p>
                    ) : (
                        <ul className="space-y-2">
                            {checklistItems.map((c) => (
                                <li key={c.id}>
                                    <label className="flex items-center gap-3 p-3 border border-zinc-200 rounded-md bg-white active:bg-amber-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={checkedIds.has(c.id)}
                                            onChange={() => toggleCheck(c.id)}
                                            className="w-5 h-5 accent-amber-600"
                                        />
                                        <span className={checkedIds.has(c.id) ? "line-through text-zinc-500" : ""}>
                                            {c.name}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <section className="space-y-3 border-t-2 border-zinc-200 pt-4">
                <div className="grid grid-cols-2 gap-3">
                    <SignaturePad label="清點人簽名" value={signature} onChange={setSignature} />
                    <div className="flex flex-col">
                        <div className="h-24 sm:h-28 border-2 border-dashed border-zinc-300 rounded-md flex items-center justify-center bg-zinc-50">
                            <span className="text-lg font-semibold text-zinc-700">洪怜俼</span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 text-center">覆核人（固定）</div>
                    </div>
                </div>

                <div>
                    <label className="text-xs text-zinc-600">備註（選填）</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className="w-full border border-zinc-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder="今天有什麼特別狀況？"
                    />
                </div>

                {error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                        ⚠ {error}
                    </div>
                )}
                {success && (
                    <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-2">
                        {success}
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="w-full py-3 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-base font-bold rounded-md disabled:opacity-60"
                >
                    {isPending ? "儲存中…" : "提交今日清點"}
                </button>
            </section>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 py-2.5 text-sm font-medium border-b-2 ${
                active ? "border-amber-600 text-amber-700" : "border-transparent text-zinc-500"
            }`}
        >
            {children}
        </button>
    );
}

function DenomTable({
    title,
    subtitle,
    denoms,
    targetQty,
    values,
    onChange,
    total,
    diff,
}: {
    title: string;
    subtitle: string;
    denoms: number[];
    targetQty: Record<number, number> | null;
    values: Record<string, string>;
    onChange: (denom: string, value: string) => void;
    total: number;
    diff: number | null;
}) {
    return (
        <section className="border-2 border-zinc-300 rounded-md overflow-hidden">
            <header className="bg-amber-100 px-3 py-2 border-b-2 border-zinc-300">
                <h3 className="font-bold text-sm">{title}</h3>
                <p className="text-xs text-zinc-600">{subtitle}</p>
            </header>
            <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs">
                    <tr>
                        <th className="px-2 py-1 text-left font-semibold w-1/4">面額</th>
                        {targetQty && <th className="px-2 py-1 font-semibold">參考張數</th>}
                        <th className="px-2 py-1 font-semibold">實際張數</th>
                        <th className="px-2 py-1 font-semibold text-right">金額</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                    {denoms.map((d) => {
                        const v = values[String(d)] ?? "";
                        const amt = d * (Number(v) || 0);
                        return (
                            <tr key={d}>
                                <td className="px-2 py-1 font-bold">{d}</td>
                                {targetQty && (
                                    <td className="px-2 py-1 text-center text-zinc-500">
                                        {targetQty[d] ?? "—"}
                                    </td>
                                )}
                                <td className="px-2 py-1 text-center">
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        min="0"
                                        value={v}
                                        onChange={(e) => onChange(String(d), e.target.value)}
                                        className="w-16 border-b border-dashed border-zinc-400 text-center font-semibold bg-transparent focus:outline-none focus:border-amber-600"
                                    />
                                </td>
                                <td className="px-2 py-1 text-right font-semibold">
                                    {amt > 0 ? amt.toLocaleString() : "—"}
                                </td>
                            </tr>
                        );
                    })}
                    <tr className="bg-amber-50/80 font-bold">
                        <td colSpan={targetQty ? 3 : 2} className="px-2 py-1.5 text-right">合計</td>
                        <td className="px-2 py-1.5 text-right text-amber-700">
                            {total > 0 ? `NT$ ${total.toLocaleString()}` : "—"}
                        </td>
                    </tr>
                    {diff !== null && diff !== 0 && (
                        <tr className="bg-red-50">
                            <td colSpan={targetQty ? 3 : 2} className="px-2 py-1 text-right text-xs text-red-700">差額</td>
                            <td className="px-2 py-1 text-right text-xs font-bold text-red-700">
                                {diff > 0 ? `+${diff.toLocaleString()}` : diff.toLocaleString()}
                            </td>
                        </tr>
                    )}
                    {diff === 0 && total > 0 && (
                        <tr className="bg-green-50">
                            <td colSpan={targetQty ? 3 : 2} className="px-2 py-1 text-right text-xs text-green-700">差額</td>
                            <td className="px-2 py-1 text-right text-xs font-bold text-green-700">✓ 平</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </section>
    );
}
