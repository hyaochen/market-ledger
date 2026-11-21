/**
 * 現金清點送出內容的驗證（純函式，submitCashCount 與單元測試共用）。
 * 'use server' 檔案只能 export async function，所以放在 lib。
 */
import { parseLocalDate, formatDateInput } from "@/lib/date";

/** 單一面額張數上限（防呆 + 防止天文數字寫進營收）。 */
export const MAX_DENOM_COUNT = 5_000;

/**
 * 各合計的上限（元）。錢盒目標約 6,785、備用金目標 6,900（見 cash-constants），
 * 上限都遠大於目標值的 10 倍；營業現金是一個攤位一天的現金，50 萬已是正常值的數十倍。
 */
export const CASH_BOX_TOTAL_MAX = 500_000;
export const RESERVE_TOTAL_MAX = 500_000;
export const SALES_TOTAL_MAX = 500_000;

/** 支出：單列金額、合計、列數上限。 */
export const EXPENSE_ROW_AMOUNT_MAX = 100_000;
export const EXPENSES_TOTAL_MAX = 200_000;
export const EXPENSE_ROWS_MAX = 50;

/** 營收備註（Revenue.note）長度上限。 */
export const REVENUE_NOTE_MAX = 500;

function yuan(n: number): string {
    return n.toLocaleString("en-US");
}

/** 錢盒／備用金／營業現金合計是否超過上限；回傳錯誤訊息，沒問題回 null。 */
export function checkCashTotalLimits(t: { cashBoxTotal: number; reserveTotal: number; salesTotal: number }): string | null {
    if (t.cashBoxTotal > CASH_BOX_TOTAL_MAX) return `錢盒合計 ${yuan(t.cashBoxTotal)} 元超過上限 ${yuan(CASH_BOX_TOTAL_MAX)} 元，請確認張數。`;
    if (t.reserveTotal > RESERVE_TOTAL_MAX) return `備用金合計 ${yuan(t.reserveTotal)} 元超過上限 ${yuan(RESERVE_TOTAL_MAX)} 元，請確認張數。`;
    if (t.salesTotal > SALES_TOTAL_MAX) return `營業現金合計 ${yuan(t.salesTotal)} 元超過上限 ${yuan(SALES_TOTAL_MAX)} 元，請確認張數。`;
    return null;
}

/** 支出列（過濾前）的列數、單列金額、合計上限；回傳錯誤訊息，沒問題回 null。 */
export function checkExpenseLimits(rows: ReadonlyArray<{ amount: number }>): string | null {
    if (rows.length > EXPENSE_ROWS_MAX) return `支出明細最多 ${EXPENSE_ROWS_MAX} 列（目前 ${rows.length} 列）。`;
    let total = 0;
    for (const r of rows) {
        const a = Number(r.amount) || 0;
        if (a > EXPENSE_ROW_AMOUNT_MAX) return `單筆支出 ${yuan(a)} 元超過上限 ${yuan(EXPENSE_ROW_AMOUNT_MAX)} 元。`;
        total += a;
    }
    if (total > EXPENSES_TOTAL_MAX) return `支出合計 ${yuan(total)} 元超過上限 ${yuan(EXPENSES_TOTAL_MAX)} 元。`;
    return null;
}

/** 今日營業額（營業現金 + 支出）不可為 0 或負；與前端 CashCountForm 同一條規則。 */
export function checkTotalSalesPositive(totalSales: number): string | null {
    if (!(totalSales > 0)) return "今日營業額是 0，請確認有沒有填金額；如果金額沒錯，請聯絡管理者。";
    return null;
}

/**
 * 簽名長度上限（字元，含 data: 前綴）。
 * 估算：SignaturePad 輸出 toDataURL("image/png")，正常路徑會先裁到筆跡範圍加邊界，
 * 一般只有數十 KB；最壞情況（裁切失敗的 fallback）是整張 canvas，橫向 modal 約
 * 1200x600 CSS px、devicePixelRatio 最高約 3 => 3600x1800，疏筆跡 PNG 約 100 KB 上下，
 * 極端塗滿也難超過 150 KB，base64 後約 200K 字元。上限取 600,000（約 3 倍餘裕以上）。
 */
export const MAX_SIGNATURE_LENGTH = 600_000;

export type SignatureResult = { ok: true; mime: "image/png" | "image/jpeg" } | { ok: false; error: string };

const SIG_PREFIX = /^data:image\/(png|jpeg|jpg);base64,/;
const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** 簽名 data URL 驗證：前綴、全部是合法 base64、長度合法、解碼後 magic bytes 與宣告類型相符。 */
export function validateSignatureDataUrl(value: unknown): SignatureResult {
    const bad = (error: string): SignatureResult => ({ ok: false, error });
    if (typeof value !== "string" || value.length === 0) return bad("簽名格式錯誤");
    if (value.length > MAX_SIGNATURE_LENGTH) return bad("簽名檔案過大");
    const m = SIG_PREFIX.exec(value);
    if (!m) return bad("簽名格式錯誤");
    const body = value.slice(m[0].length);
    if (body.length < 16 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) return bad("簽名格式錯誤");
    const head = Buffer.from(body.slice(0, 16), "base64");
    const isPng = m[1] === "png";
    const magic = isPng ? PNG_MAGIC : JPEG_MAGIC;
    if (!magic.every((b, i) => head[i] === b)) return bad("簽名內容與圖片類型不符");
    return { ok: true, mime: isPng ? "image/png" : "image/jpeg" };
}

/**
 * 營收備註附加修正標記：標記已在結尾就不重複附加；整串截到 REVENUE_NOTE_MAX 以內
 * （超長時截掉前面的舊內容，保留標記）。
 */
export function appendRevenueNote(existing: string | null | undefined, marker: string, max: number = REVENUE_NOTE_MAX): string {
    const sep = " | ";
    let base = existing ?? "";
    if (base.endsWith(marker)) {
        base = base.slice(0, base.length - marker.length);
        if (base.endsWith(sep)) base = base.slice(0, base.length - sep.length);
        else if (base !== "") return existing!.slice(0, max); // 標記黏在別的文字後面，原樣保留
    }
    const tail = base === "" ? marker : sep + marker;
    const room = max - tail.length;
    if (room < 0) return marker.slice(0, max);
    if (base.length > room) base = base.slice(0, room);
    return base === "" ? marker : base + tail;
}

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
