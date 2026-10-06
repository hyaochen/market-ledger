/**
 * cash 清點表單的草稿機制（sessionStorage）。
 *
 * 原本整段寫在 CashCountForm.tsx 裡，T-ML-034 介面重設計時原樣搬出來，
 * 好讓「登出前偵測還有沒有草稿」與單元測試可以共用同一份定義。
 * 機制本身（key 格式、schema 版本、什麼算有內容）完全沒有改動：
 * - key：cashcount-draft:${attendantId}:${date}
 * - schema 版本 1，版本不符的舊草稿一律忽略
 */

export const DRAFT_SCHEMA_VERSION = 1;

/** 所有 cash 草稿 key 的共同前綴；登出確認對話框用它判斷這台裝置上還有沒有沒提交的草稿。 */
export const CASH_DRAFT_PREFIX = "cashcount-draft:";

export type ExpenseRow = { item: string; note: string; amount: string };

export type DraftPayload = {
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

export function draftKey(attendantId: string, date: string) {
    return `${CASH_DRAFT_PREFIX}${attendantId}:${date}`;
}

export function readDraft(key: string): DraftPayload | null {
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

export function writeDraft(key: string, payload: DraftPayload) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
        // quota / private mode — silently skip
    }
}

export function clearDraft(key: string) {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
}

export function draftHasContent(p: DraftPayload): boolean {
    if (p.signature) return true;
    if (p.note.trim().length > 0) return true;
    if (p.checkedIds.length > 0) return true;
    if (Object.values(p.cashBox).some((v) => v && Number(v) > 0)) return true;
    if (Object.values(p.reserve).some((v) => v && Number(v) > 0)) return true;
    if (Object.values(p.sales).some((v) => v && Number(v) > 0)) return true;
    if (p.expenses.some((r) => r.item.trim() || r.note.trim() || (Number(r.amount) || 0) > 0)) return true;
    return false;
}

type StorageLike = { readonly length: number; key(index: number): string | null };

/** 這個 storage 裡有沒有任何 cash 清點草稿（只看 key，不解析內容）。 */
export function hasCashDraft(storage: StorageLike): boolean {
    for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(CASH_DRAFT_PREFIX)) return true;
    }
    return false;
}

/** 在瀏覽器內安全地檢查 sessionStorage（隱私模式或被封鎖時回 false）。 */
export function browserHasCashDraft(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return hasCashDraft(window.sessionStorage);
    } catch {
        return false;
    }
}
