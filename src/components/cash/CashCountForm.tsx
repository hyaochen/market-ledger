"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, ClipboardList, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import SignaturePad from "./SignaturePad";
import { submitCashCount } from "@/app/actions/cash";
import {
    CASH_BOX_DENOMS,
    CASH_BOX_TARGET_QTY,
    CASH_BOX_TARGET_TOTAL,
    RESERVE_DENOMS,
    RESERVE_TARGET_QTY,
    RESERVE_TARGET_TOTAL,
    SALES_DENOMS,
} from "@/lib/cash-constants";
import { diffStatus, formatDateWithWeekday, formatNtd } from "@/lib/cash-ui";
import {
    DRAFT_SCHEMA_VERSION,
    clearDraft,
    draftHasContent,
    draftKey,
    readDraft,
    writeDraft,
    type DraftPayload,
    type ExpenseRow,
} from "@/lib/cash-draft";
import { submissionNoticeText, type SubmissionNotice } from "@/lib/cash-queries";
import { cn } from "@/lib/utils";
import CashConfirmDialog from "./CashConfirmDialog";
import ChecklistSection from "./form/ChecklistSection";
import DenomSection from "./form/DenomSection";
import ExpenseSection from "./form/ExpenseSection";
import SectionCard from "./form/SectionCard";
import SummaryBar from "./form/SummaryBar";
import { InfoChip } from "./StatusChip";
import { btn, CARD, notice } from "./ui";

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
    /** 今天這個攤位已經提交過的紀錄（只用來提醒「再提交會覆蓋」，不會預填內容） */
    existing?: SubmissionNotice | null;
};

const INITIAL_EXPENSE_ROWS = 6;

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

/**
 * 每日現金清點表單（T-ML-034 介面重設計）。
 *
 * 只重組版面與樣式；以下行為與重設計前完全等價：
 * - 計算（面額 x 張數、支出合計、今日營業額 = 營業現金 + 當天支出）與差額判斷（合計 0 視為未填）
 * - 草稿：sessionStorage key `cashcount-draft:${attendantId}:${date}`、schema 版本 1、300ms debounce 寫入
 * - beforeunload 防呆（有內容且尚未提交成功才攔）
 * - submitCashCount 呼叫、錯誤處理、成功後 1.2 秒導向 /cash/history
 */
export default function CashCountForm({ today, attendantId, attendantName, locationName, checklistItems, existing = null }: Props) {
    const router = useRouter();
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
    const [discardOpen, setDiscardOpen] = useState(false);
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
            // 提交成功後不要再寫草稿：若最後一次編輯後 300ms 內就提交成功，
            // 這個計時器會在 clearDraft 之後才觸發，把已送出的內容又存成草稿。
            if (submittedRef.current) return;
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

    // 差額判斷與原本相同：合計為 0 視為「尚未填寫」，其餘才跟目標比
    const cashBoxStatus = diffStatus(cashBoxTotal, CASH_BOX_TARGET_TOTAL);
    const reserveStatus = diffStatus(reserveTotal, RESERVE_TARGET_TOTAL);

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
        setCashBox(emptyDenomState(CASH_BOX_DENOMS));
        setReserve(emptyDenomState(RESERVE_DENOMS));
        setSales(emptyDenomState(SALES_DENOMS));
        setExpenses(emptyExpenses());
        setCheckedIds(new Set());
        setSignature(null);
        setNote("");
        clearDraft(key);
        setRestoredAt(null);
        setDiscardOpen(false);
    }

    function handleSubmit() {
        setError(null);
        setSuccess(null);

        if (!signature) {
            setError("請先簽名再提交。");
            return;
        }
        if (totalSales <= 0) {
            setError("今日營業額是 0，請確認有沒有填金額；如果金額沒錯，請聯絡管理者。");
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
            setSuccess(`已儲存。今日營業額 ${formatNtd(totalSales)}，已同步到營業額表。`);
            router.refresh();
            setTimeout(() => router.push("/cash/history"), 1200);
        });
    }

    return (
        <div className="px-4 pb-4 pt-4 md:pt-6">
            <div className="space-y-4">
                {/* 今天這個攤位已經提交過：提醒再次提交會覆蓋（不預填、不改提交語意） */}
                {existing && (
                    <section
                        aria-label="今天已經提交過"
                        className={notice("warn", "flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}
                    >
                        <div className="flex min-w-0 flex-1 items-start gap-2.5 font-bold">
                            <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                            <p>{submissionNoticeText(existing)}</p>
                        </div>
                        <Link href={`/cash/history/${existing.id}`} className={btn("secondary", "sm", "w-full shrink-0 sm:w-auto")}>
                            查看已提交內容
                        </Link>
                    </section>
                )}

                {/* 草稿還原提示 */}
                {restoredAt !== null && (
                    <div role="status" className={notice("info", "items-center justify-between gap-3")}>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-bold">
                                <ClipboardList className="h-5 w-5 shrink-0" aria-hidden="true" />
                                找到上次沒填完的清點，已幫你還原
                            </div>
                            <div className="mt-0.5 text-[15px]">
                                儲存時間：{new Date(restoredAt).toLocaleTimeString("zh-Hant-TW", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setDiscardOpen(true)}
                            aria-haspopup="dialog"
                            className={btn("secondary", "sm", "shrink-0")}
                        >
                            丟棄草稿
                        </button>
                    </div>
                )}

                {/* 這份清點的資訊：攤位用大字，避免記到錯的攤位 */}
                <section aria-labelledby="cash-info-title" className={cn(CARD, "p-4")}>
                    <h1 id="cash-info-title" className="text-[15px] font-bold text-amber-800">
                        今日現金清點
                    </h1>
                    <p className="mt-1 text-3xl font-extrabold leading-tight text-stone-900">{locationName}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-stone-200 pt-3 text-base sm:grid-cols-3">
                        <div className="col-span-2 sm:col-span-1">
                            <dt className="text-[13px] text-stone-600">日期</dt>
                            <dd className="font-bold text-stone-900">{formatDateWithWeekday(today)}</dd>
                        </div>
                        <div>
                            <dt className="text-[13px] text-stone-600">清點人</dt>
                            <dd className="font-bold text-stone-900">{attendantName}</dd>
                        </div>
                        <div>
                            <dt className="text-[13px] text-stone-600">覆核人（固定）</dt>
                            <dd className="font-bold text-stone-900">洪怜俼</dd>
                        </div>
                    </dl>
                </section>

                {/* 捲動後仍看得到：今日營業額 + 錢盒/備用金狀態 */}
                <SummaryBar totalSales={totalSales} cashBox={cashBoxStatus} reserve={reserveStatus} />

                <DenomSection
                    step={1}
                    title="錢盒清點"
                    description={`目標 ${formatNtd(CASH_BOX_TARGET_TOTAL)}（各面額張數固定）`}
                    denoms={[...CASH_BOX_DENOMS]}
                    targetQty={CASH_BOX_TARGET_QTY}
                    targetTotal={CASH_BOX_TARGET_TOTAL}
                    values={cashBox}
                    onChange={(d, v) => setCashBox((p) => ({ ...p, [d]: v }))}
                    total={cashBoxTotal}
                />

                <DenomSection
                    step={2}
                    title="備用金清點"
                    description={`目標 ${formatNtd(RESERVE_TARGET_TOTAL)}（總額固定）`}
                    denoms={[...RESERVE_DENOMS]}
                    targetQty={RESERVE_TARGET_QTY}
                    targetTotal={RESERVE_TARGET_TOTAL}
                    values={reserve}
                    onChange={(d, v) => setReserve((p) => ({ ...p, [d]: v }))}
                    total={reserveTotal}
                />

                <DenomSection
                    step={3}
                    title="當日營業現金"
                    description={`扣掉要留的錢盒 ${formatNtd(CASH_BOX_TARGET_TOTAL)} 和備用金 ${formatNtd(RESERVE_TARGET_TOTAL)} 之後，剩下的現金`}
                    denoms={[...SALES_DENOMS]}
                    targetQty={null}
                    targetTotal={null}
                    values={sales}
                    onChange={(d, v) => setSales((p) => ({ ...p, [d]: v }))}
                    total={salesTotal}
                />

                <ExpenseSection step={4} rows={expenses} total={expensesTotal} onChange={updateExpense} onAddRow={addExpenseRow} />

                {/* 今日營業額 = 營業現金 + 當天支出 */}
                <section
                    aria-label="今日營業額"
                    className="rounded-2xl border-2 border-stone-800 bg-amber-100 px-5 py-4"
                >
                    <div className="flex items-baseline justify-between gap-3">
                        <h2 className="text-lg font-bold text-stone-900">今日營業額</h2>
                        <p className="text-3xl font-extrabold tabular-nums text-stone-900">
                            {totalSales > 0 ? formatNtd(totalSales) : "—"}
                        </p>
                    </div>
                    <p className="mt-1.5 text-[15px] text-stone-800">
                        營業現金 {formatNtd(salesTotal)} ＋ 當天支出 {formatNtd(expensesTotal)}
                    </p>
                </section>

                <ChecklistSection step={5} items={checklistItems} checkedIds={checkedIds} onToggle={toggleCheck} />

                <SectionCard
                    step={6}
                    title="簽名確認"
                    description="請清點人簽名；覆核人固定是洪怜俼。"
                    status={
                        signature ? (
                            <InfoChip tone="ok" icon={CircleCheck}>已簽名</InfoChip>
                        ) : (
                            <InfoChip tone="muted">尚未簽名</InfoChip>
                        )
                    }
                >
                    <div className="space-y-4 p-4">
                        <div className="grid grid-cols-2 gap-3">
                            <SignaturePad label="清點人簽名" value={signature} onChange={setSignature} />
                            <div className="flex flex-col">
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                    <span className="text-base font-bold text-stone-900">覆核人</span>
                                    <span className="text-[13px] text-stone-600">固定</span>
                                </div>
                                <div className="flex h-28 items-center justify-center rounded-xl border-2 border-stone-300 bg-stone-50">
                                    <span className="text-xl font-bold text-stone-900">洪怜俼</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="cash-note" className="mb-1.5 block text-base font-bold text-stone-900">
                                備註<span className="ml-1.5 text-[15px] font-normal text-stone-600">（選填）</span>
                            </label>
                            <textarea
                                id="cash-note"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                className="scroll-mb-[calc(5rem+env(safe-area-inset-bottom,0px))] scroll-mt-36 w-full rounded-xl border border-stone-500 bg-white px-3 py-2.5 text-base text-stone-900 placeholder:text-stone-500"
                                placeholder="今天有什麼特別狀況？"
                            />
                        </div>
                    </div>
                </SectionCard>

                {error && (
                    <div role="alert" className={notice("bad")}>
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                        <span>{error}</span>
                    </div>
                )}
                {success && (
                    <div role="status" className={notice("ok")}>
                        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                        <span>{success}</span>
                    </div>
                )}

                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    aria-busy={isPending}
                    className={btn("primary", "lg", "w-full")}
                >
                    {isPending ? (
                        <>
                            <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            儲存中…
                        </>
                    ) : (
                        "提交今日清點"
                    )}
                </button>
                {existing ? (
                    <p className="text-center text-[15px] text-stone-700">
                        這會覆蓋 {existing.timeLabel} 由 {existing.byName} 提交的內容。
                    </p>
                ) : null}
            </div>

            <CashConfirmDialog
                open={discardOpen}
                onOpenChange={setDiscardOpen}
                title="丟棄這份草稿？"
                description="已自動還原的內容會全部清空，沒辦法再找回來。"
                confirmLabel="丟棄草稿"
                tone="danger"
                onConfirm={handleDiscardDraft}
            />
        </div>
    );
}
