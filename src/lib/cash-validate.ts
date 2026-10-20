/**
 * 現金清點送出內容的驗證（純函式，submitCashCount 與單元測試共用）。
 * 'use server' 檔案只能 export async function，所以放在 lib。
 */
import { parseLocalDate, formatDateInput } from "@/lib/date";

/** 單一面額張數上限（防呆 + 防止天文數字寫進營收）。 */
export const MAX_DENOM_COUNT = 100_000;

export type DenomResult = { ok: true; map: Record<string, number>; total: number } | { ok: false; error: string };

/**
 * 面額表驗證：
 * - key 必須是 allowed 面額之一（不認得的面額直接拒絕，不是忽略）
 * - 張數必須是 0 ~ MAX_DENOM_COUNT 的整數
 * 回傳只含允許面額的正規化 map（缺的面額補 0）與合計。
 */
export function parseDenomMap(input: unknown, allowed: readonly number[], label: string): DenomResult {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { ok: false, error: `${label}資料格式錯誤` };
    }
    const allowedKeys = new Set(allowed.map(String));
    const map: Record<string, number> = Object.fromEntries(allowed.map((d) => [String(d), 0]));
    let total = 0;
    for (const [key, qty] of Object.entries(input as Record<string, unknown>)) {
        if (!allowedKeys.has(key)) return { ok: false, error: `${label}含有不認得的面額：${key}` };
        if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > MAX_DENOM_COUNT) {
            return { ok: false, error: `${label}的 ${key} 元張數必須是 0 以上的整數` };
        }
        map[key] = qty;
        total += Number(key) * qty;
    }
    return { ok: true, map, total };
}

/** 清點日期可以比今天早多少天（補登上限）／晚多少天（時區誤差上限）。 */
export const CASH_DATE_MAX_PAST_DAYS = 366;
export const CASH_DATE_MAX_FUTURE_DAYS = 1;

/** 解析 YYYY-MM-DD；格式不對、不存在的日期（2026-02-31）、或離今天太遠都回 null。 */
export function parseSaneCashDate(value: string, now: Date = new Date()): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = parseLocalDate(value);
    if (!date || formatDateInput(date) !== value) return null;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
    if (diffDays > CASH_DATE_MAX_FUTURE_DAYS || diffDays < -CASH_DATE_MAX_PAST_DAYS) return null;
    return date;
}

/** 去重 checklist id（同一項目送兩次只算一次，後者覆蓋前者）。 */
export function dedupeChecklist(rows: Array<{ id: string; done: boolean }>): Array<{ id: string; done: boolean }> {
    const byId = new Map<string, boolean>();
    for (const r of rows) byId.set(r.id, r.done);
    return [...byId].map(([id, done]) => ({ id, done }));
}
