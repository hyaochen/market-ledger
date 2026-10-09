// POS 資料查詢（唯讀）。資料來源是 yjc.db（見 yjc-db.ts）。
//
// 欄位語意（2026-10-09 對照真實資料驗證）：
//   i_orders : 一筆 = 一張單。m_WorkDate 營業日 'YYYY/MM/DD'；m_SaleTime 'YYYY-MM-DD HH:MM:SS.mmm'
//   i_items  : 明細。p_OrderID -> m_OrderNo；p_Weight 單位是「公斤」
//   i_checks : 付款。c_OrderID -> m_OrderNo
//
// SQL 一律參數化；表名只來自 POS_TABLES 白名單，欄位名只來自 PRAGMA table_info 實查結果，
// 排序方式只來自程式碼內的固定對照表。

import { POS_TABLES, getYjcDb, isPosTable, listTableColumns } from "@/lib/yjc-db";

export const PAGE_SIZE = 50;
import { KG_PER_TAIWAN_CATTY } from "./pos-constants";
export { KG_PER_TAIWAN_CATTY };

export function kgToCatty(kg: number | null | undefined): number {
    return (Number(kg) || 0) / KG_PER_TAIWAN_CATTY;
}

// ---------------------------------------------------------------------------
// 日期工具（營業日都是台北時間；容器 TZ 是 UTC，所以不能用 new Date() 的本地日期）

const DAY_MS = 24 * 3600 * 1000;

export function taipeiToday(): string {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 接受 YYYY-MM-DD 或 YYYY/MM/DD，回傳 YYYY-MM-DD；不合法回 null。 */
export function parseIsoDate(v: string | undefined | null): string | null {
    if (!v) return null;
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(v.trim());
    if (!m) return null;
    const [, y, mo, d] = m;
    const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
    const back = new Date(t).toISOString().slice(0, 10);
    return back === `${y}-${mo}-${d}` ? back : null;
}

/** YYYY-MM-DD -> POS 的 YYYY/MM/DD */
export function toPosDate(iso: string): string {
    return iso.replace(/-/g, "/");
}

export type DateRange = { from: string | null; to: string | null }; // ISO，null = 不限

/**
 * 解析 from/to 查詢參數。參數「完全沒出現」才套預設區間；使用者把欄位清空送出（空字串）代表不限。
 */
export function resolveRange(
    fromParam: string | undefined,
    toParam: string | undefined,
    defaultDays: number
): DateRange {
    if (fromParam === undefined && toParam === undefined) {
        const today = taipeiToday();
        return { from: addDays(today, -(defaultDays - 1)), to: today };
    }
    return { from: parseIsoDate(fromParam), to: parseIsoDate(toParam) };
}

function rangeClause(col: string, range: DateRange): { sql: string; params: string[] } {
    // col 只由本檔內固定字串傳入
    const parts: string[] = [];
    const params: string[] = [];
    if (range.from) {
        parts.push(`${col} >= ?`);
        params.push(toPosDate(range.from));
    }
    if (range.to) {
        parts.push(`${col} <= ?`);
        params.push(toPosDate(range.to));
    }
    return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
}

// ---------------------------------------------------------------------------

function tableExists(table: string): boolean {
    return listTableColumns(table).length > 0;
}

export function hasPosData(): boolean {
    return tableExists("i_orders");
}

function escapeLike(s: string): string {
    return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export type DailyRow = { key: string; orders: number; total: number; avg: number };

export function getRevenue(range: DateRange, by: "day" | "month") {
    if (!tableExists("i_orders")) return { rows: [] as DailyRow[], orders: 0, total: 0, avg: 0 };
    const db = getYjcDb();
    const keyExpr = by === "month" ? "substr(m_WorkDate, 1, 7)" : "m_WorkDate";
    const rc = rangeClause("m_WorkDate", range);
    const raw = db
        .prepare(
            `SELECT ${keyExpr} AS k, COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t
             FROM i_orders WHERE m_Checkout = 1${rc.sql}
             GROUP BY k ORDER BY k DESC`
        )
        .all(...rc.params) as Array<{ k: string; n: number; t: number }>;
    const rows = raw.map((r) => ({ key: r.k, orders: r.n, total: r.t, avg: r.n ? r.t / r.n : 0 }));
    const orders = rows.reduce((a, r) => a + r.orders, 0);
    const total = rows.reduce((a, r) => a + r.total, 0);
    return { rows, orders, total, avg: orders ? total / orders : 0 };
}

export type OrderRow = {
    m_OrderNo: string;
    m_WorkDate: string;
    m_SaleTime: string;
    m_Total: number;
    m_Checkout: number;
    itemCount: number;
    itemSum: number | null;
};

/** 明細加總與單據總額差超過這個值才算不符（浮點誤差用）。 */
export const MISMATCH_EPS = 0.5;

export function searchOrders(range: DateRange, q: string, page: number, onlyDiff = false) {
    if (!tableExists("i_orders")) return { rows: [] as OrderRow[], total: 0 };
    const db = getYjcDb();
    const rc = rangeClause("m_WorkDate", range);
    let where = `1 = 1${rc.sql}`;
    const params: Array<string | number> = [...rc.params];
    const needle = q.trim();
    if (needle) {
        where += ` AND m_OrderNo LIKE ? ESCAPE '\\'`;
        params.push(`%${escapeLike(needle)}%`);
    }
    // 只看「明細加總 != 單據總額」：沒有明細的單視為 0
    if (onlyDiff) {
        where += ` AND ABS(m_Total - COALESCE((SELECT SUM(p_Total) FROM i_items WHERE p_OrderID = i_orders.m_OrderNo), 0)) > ${MISMATCH_EPS}`;
    }
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM i_orders WHERE ${where}`).get(...params) as { c: number }).c;
    const rows = db
        .prepare(
            `SELECT m_OrderNo, m_WorkDate, m_SaleTime, m_Total, m_Checkout,
                    (SELECT COUNT(*) FROM i_items WHERE p_OrderID = i_orders.m_OrderNo) AS itemCount,
                    (SELECT SUM(p_Total) FROM i_items WHERE p_OrderID = i_orders.m_OrderNo) AS itemSum
             FROM i_orders WHERE ${where}
             ORDER BY m_SaleTime DESC, m_OrderNo DESC LIMIT ? OFFSET ?`
        )
        .all(...params, PAGE_SIZE, (Math.max(1, page) - 1) * PAGE_SIZE) as OrderRow[];
    return { rows, total };
}

export type OrderItem = {
    p_serno: number;
    p_FoodName: string;
    p_Count: number;
    p_Weight: number;
    p_Price: number;
    p_Total: number;
    p_Return: number;
};
export type OrderCheck = { c_serNO: number; c_KindName: string; c_Total: number };

export function getOrderDetail(orderNo: string) {
    if (!tableExists("i_orders")) return null;
    const db = getYjcDb();
    const order = db
        .prepare(
            `SELECT m_OrderNo, m_WorkDate, m_SaleTime, m_CloseTime, m_Total, m_PayTotal, m_Checkout
             FROM i_orders WHERE m_OrderNo = ?`
        )
        .get(orderNo) as
        | {
              m_OrderNo: string;
              m_WorkDate: string;
              m_SaleTime: string;
              m_CloseTime: string | null;
              m_Total: number;
              m_PayTotal: number | null;
              m_Checkout: number;
          }
        | undefined;
    if (!order) return null;
    const items = tableExists("i_items")
        ? (db
              .prepare(
                  `SELECT p_serno, p_FoodName, p_Count, p_Weight, p_Price, p_Total, p_Return
                   FROM i_items WHERE p_OrderID = ? ORDER BY p_serno`
              )
              .all(orderNo) as OrderItem[])
        : [];
    const checks = tableExists("i_checks")
        ? (db
              .prepare(`SELECT c_serNO, c_KindName, c_Total FROM i_checks WHERE c_OrderID = ? ORDER BY c_serNO`)
              .all(orderNo) as OrderCheck[])
        : [];
    const itemSum = items.reduce((a, i) => a + (Number(i.p_Total) || 0), 0);
    const diff = Number(order.m_Total) - itemSum;
    return { order, items, checks, itemSum, diff, mismatch: Math.abs(diff) > MISMATCH_EPS };
}

export const ITEM_SORTS = {
    total: "total DESC",
    weight: "kg DESC",
    count: "n DESC",
} as const;
export type ItemSort = keyof typeof ITEM_SORTS;

export type ItemRankRow = { name: string; total: number; kg: number; n: number; ids: number; minPrice: number; maxPrice: number };

export function getItemRanking(range: DateRange, sort: ItemSort) {
    if (!tableExists("i_orders") || !tableExists("i_items")) return { rows: [] as ItemRankRow[], total: 0 };
    const db = getYjcDb();
    const rc = rangeClause("o.m_WorkDate", range);
    const rows = db
        .prepare(
            `SELECT TRIM(i.p_FoodName) AS name, COALESCE(SUM(i.p_Total), 0) AS total,
                    COALESCE(SUM(i.p_Weight), 0) AS kg, COUNT(*) AS n,
                    COUNT(DISTINCT i.p_FoodID) AS ids,
                    COALESCE(MIN(i.p_Price), 0) AS minPrice, COALESCE(MAX(i.p_Price), 0) AS maxPrice
             FROM i_items i JOIN i_orders o ON o.m_OrderNo = i.p_OrderID
             WHERE o.m_Checkout = 1${rc.sql}
             GROUP BY TRIM(i.p_FoodName)
             ORDER BY ${ITEM_SORTS[sort]}, name
             LIMIT 500`
        )
        .all(...rc.params) as ItemRankRow[];
    const totalRow = db
        .prepare(
            `SELECT COALESCE(SUM(i.p_Total), 0) AS t
             FROM i_items i JOIN i_orders o ON o.m_OrderNo = i.p_OrderID
             WHERE o.m_Checkout = 1${rc.sql}`
        )
        .get(...rc.params) as { t: number };
    return { rows, total: totalRow.t };
}

// ---------------------------------------------------------------------------
// 原始資料瀏覽

export function listExistingTables(): string[] {
    return POS_TABLES.filter((t) => tableExists(t));
}

export function getRawPage(table: string, col: string, q: string, page: number) {
    if (!isPosTable(table)) return null;
    const columns = listTableColumns(table);
    if (columns.length === 0) return null;
    const db = getYjcDb();
    // 欄位名只接受 PRAGMA 實際查到的
    const useCol = col && columns.includes(col) ? col : "";
    const needle = q.trim();
    let where = "";
    const params: string[] = [];
    if (useCol && needle) {
        where = ` WHERE CAST("${useCol}" AS TEXT) LIKE ? ESCAPE '\\'`;
        params.push(`%${escapeLike(needle)}%`);
    }
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"${where}`).get(...params) as { c: number }).c;
    const rows = db
        .prepare(`SELECT * FROM "${table}"${where} ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(...params, PAGE_SIZE, (Math.max(1, page) - 1) * PAGE_SIZE) as Array<Record<string, unknown>>;
    return { columns, rows, total, activeCol: useCol };
}
