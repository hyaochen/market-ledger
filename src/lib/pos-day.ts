// 單日深入分析（/pos/daily/<日期>）。營業日一律用 m_WorkDate（與 Z 帳一致）。
// 傳進來的日期一律是 POS 格式 'YYYY/MM/DD'。

import { getYjcDb, listTableColumns } from "@/lib/yjc-db";
import { KG_PER_TAIWAN_CATTY, MISMATCH_EPS } from "@/lib/pos-queries";
import { checkSequence, getZDay, getHours, weekdayOf } from "@/lib/pos-reports";

function has(table: string, ...cols: string[]): boolean {
    const have = listTableColumns(table);
    return have.length > 0 && cols.every((c) => have.includes(c));
}

export function isoToPos(iso: string): string {
    return iso.replace(/-/g, "/");
}
export function posToIso(pos: string): string {
    return pos.replace(/\//g, "-");
}

function shiftDate(pos: string, days: number): string {
    const [y, m, d] = pos.split("/").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
    return t.toISOString().slice(0, 10).replace(/-/g, "/");
}

export type DayMetrics = { orders: number; total: number; avg: number; catty: number };

export function dayMetrics(date: string): DayMetrics | null {
    const db = getYjcDb();
    const o = db
        .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1`)
        .get(date) as { n: number; t: number };
    if (o.n === 0) return null;
    const w = has("i_items", "p_OrderID", "p_Weight")
        ? (db
              .prepare(
                  `SELECT COALESCE(SUM(i.p_Weight), 0) AS kg FROM i_items i
                   JOIN i_orders o ON o.m_OrderNo = i.p_OrderID
                   WHERE o.m_WorkDate = ? AND o.m_Checkout = 1`
              )
              .get(date) as { kg: number })
        : { kg: 0 };
    return { orders: o.n, total: o.t, avg: o.n ? o.t / o.n : 0, catty: w.kg / KG_PER_TAIWAN_CATTY };
}

export function prevBusinessDay(date: string): string | null {
    const r = getYjcDb()
        .prepare(`SELECT MAX(m_WorkDate) AS d FROM i_orders WHERE m_WorkDate < ? AND m_Checkout = 1`)
        .get(date) as { d: string | null };
    return r.d;
}
export function nextBusinessDay(date: string): string | null {
    const r = getYjcDb()
        .prepare(`SELECT MIN(m_WorkDate) AS d FROM i_orders WHERE m_WorkDate > ? AND m_Checkout = 1`)
        .get(date) as { d: string | null };
    return r.d;
}

export type Comparison = {
    label: string;
    note: string; // 例如對照日期、樣本數
    base: DayMetrics | null;
};

export type MetricKey = keyof DayMetrics;

export function diffPct(cur: number, base: number): { diff: number; pct: number | null } {
    const diff = cur - base;
    return { diff, pct: base !== 0 ? (diff / base) * 100 : null };
}

export function averageMetrics(list: DayMetrics[]): DayMetrics | null {
    if (list.length === 0) return null;
    const n = list.length;
    const sum = list.reduce(
        (a, m) => ({ orders: a.orders + m.orders, total: a.total + m.total, avg: a.avg + m.avg, catty: a.catty + m.catty }),
        { orders: 0, total: 0, avg: 0, catty: 0 }
    );
    // 客單價用「日均營收 / 日均單數」，不是各日客單價的平均
    const orders = sum.orders / n;
    const total = sum.total / n;
    return { orders, total, avg: orders ? total / orders : 0, catty: sum.catty / n };
}

export function getComparisons(date: string): Comparison[] {
    const prev = prevBusinessDay(date);
    const lastWeek = shiftDate(date, -7);
    const four: string[] = [];
    const fourMetrics: DayMetrics[] = [];
    for (let k = 1; k <= 4; k++) {
        const d = shiftDate(date, -7 * k);
        const m = dayMetrics(d);
        if (m) {
            four.push(d);
            fourMetrics.push(m);
        }
    }
    return [
        { label: "前一個營業日", note: prev ?? "無資料", base: prev ? dayMetrics(prev) : null },
        { label: "上週同一天", note: lastWeek + "（週" + "日一二三四五六"[weekdayOf(lastWeek)] + "）", base: dayMetrics(lastWeek) },
        {
            label: "近 4 週同星期平均",
            note: fourMetrics.length ? `取 ${fourMetrics.length} 個有營業的同星期` : "近 4 週同星期都沒營業",
            base: averageMetrics(fourMetrics),
        },
    ];
}

export type DayItemRow = { name: string; n: number; qty: number; kg: number; total: number };
export const DAY_ITEM_SORTS = {
    total: "total DESC",
    weight: "kg DESC",
    count: "n DESC",
    qty: "qty DESC",
} as const;
export type DayItemSort = keyof typeof DAY_ITEM_SORTS;

export function getDayItems(date: string, sort: DayItemSort) {
    if (!has("i_items", "p_OrderID", "p_FoodName")) return { rows: [] as DayItemRow[], total: 0 };
    const db = getYjcDb();
    const rows = db
        .prepare(
            `SELECT TRIM(i.p_FoodName) AS name, COUNT(*) AS n, COALESCE(SUM(i.p_Count), 0) AS qty,
                    COALESCE(SUM(i.p_Weight), 0) AS kg, COALESCE(SUM(i.p_Total), 0) AS total
             FROM i_items i JOIN i_orders o ON o.m_OrderNo = i.p_OrderID
             WHERE o.m_WorkDate = ? AND o.m_Checkout = 1
             GROUP BY TRIM(i.p_FoodName) ORDER BY ${DAY_ITEM_SORTS[sort]}, name`
        )
        .all(date) as DayItemRow[];
    return { rows, total: rows.reduce((a, r) => a + r.total, 0) };
}

export type DayOrderRow = {
    m_OrderNo: string;
    m_SaleTime: string;
    m_CloseTime: string | null;
    m_Total: number;
    itemCount: number;
    itemSum: number | null;
    mismatch: boolean;
    diff: number;
};

export function getDayOrders(date: string): DayOrderRow[] {
    const rows = getYjcDb()
        .prepare(
            `SELECT m_OrderNo, m_SaleTime, m_CloseTime, m_Total,
                    (SELECT COUNT(*) FROM i_items WHERE p_OrderID = i_orders.m_OrderNo) AS itemCount,
                    (SELECT SUM(p_Total) FROM i_items WHERE p_OrderID = i_orders.m_OrderNo) AS itemSum
             FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1
             ORDER BY COALESCE(m_CloseTime, m_SaleTime), m_OrderNo`
        )
        .all(date) as Array<Omit<DayOrderRow, "mismatch" | "diff">>;
    return rows.map((r) => {
        const diff = Number(r.m_Total) - (Number(r.itemSum) || 0);
        return { ...r, diff, mismatch: Math.abs(diff) > MISMATCH_EPS };
    });
}

export type DayAnomaly = { kind: string; label: string; detail: string };

function dayOf(t: string | null): string {
    return (t ?? "").slice(0, 10).replace(/-/g, "/");
}

export function getDayAnomalies(date: string): DayAnomaly[] {
    const db = getYjcDb();
    const out: DayAnomaly[] = [];

    // 退貨：單號以 # 結尾的沖銷單，或明細 p_Return = 1
    const returns = db
        .prepare(`SELECT m_OrderNo AS no, m_Total AS t FROM i_orders WHERE m_WorkDate = ? AND m_OrderNo LIKE '%#'`)
        .all(date) as Array<{ no: string; t: number }>;
    const returnItems = has("i_items", "p_Return")
        ? (db
              .prepare(
                  `SELECT DISTINCT i.p_OrderID AS no FROM i_items i JOIN i_orders o ON o.m_OrderNo = i.p_OrderID
                   WHERE o.m_WorkDate = ? AND i.p_Return = 1`
              )
              .all(date) as Array<{ no: string }>)
        : [];
    const retNos = Array.from(new Set([...returns.map((r) => r.no), ...returnItems.map((r) => r.no)]));
    if (retNos.length) {
        out.push({ kind: "return", label: "退貨", detail: `${retNos.length} 張：${retNos.join("、")}` });
    }

    // 作廢／刪除的單
    if (has("i_ordersDelete", "m_WorkDate")) {
        const del = db
            .prepare(`SELECT m_OrderNo AS no FROM i_ordersDelete WHERE m_WorkDate = ?`)
            .all(date) as Array<{ no: string }>;
        let itemRows = 0;
        if (del.length && has("i_itemsDelete", "p_OrderID")) {
            itemRows = (db
                .prepare(
                    `SELECT COUNT(*) AS c FROM i_itemsDelete WHERE p_OrderID IN (SELECT m_OrderNo FROM i_ordersDelete WHERE m_WorkDate = ?)`
                )
                .get(date) as { c: number }).c;
        }
        if (del.length) {
            out.push({
                kind: "deleted",
                label: "作廢／刪除的單",
                detail: `${del.length} 張（${del.map((d) => d.no).join("、")}），含 ${itemRows} 列明細`,
            });
        }
    }

    // 流水號跳號
    const seq = checkSequence(date);
    if (seq.gaps.length) {
        const unexplained = seq.gaps.filter((g) => !seq.explained.includes(g));
        const fmtG = (a: number[]) => a.slice(0, 12).map((g) => String(g).padStart(4, "0")).join("、");
        out.push({
            kind: "gap",
            label: "流水號跳號",
            detail:
                `缺 ${seq.gaps.length} 號（${fmtG(seq.gaps)}）` +
                (seq.explained.length ? `；其中 ${seq.explained.length} 號是 POS 作廢單` : "") +
                (unexplained.length ? `；${unexplained.length} 號查不到原因` : ""),
        });
    }

    // 跨日補結：m_WorkDate = 當日但結帳日不同；或結帳在當日但營業日不是當日
    const iso = posToIso(date);
    const late = (db
        .prepare(`SELECT m_OrderNo AS no, m_CloseTime AS c FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1`)
        .all(date) as Array<{ no: string; c: string | null }>).filter((r) => dayOf(r.c) !== date);
    if (late.length) {
        out.push({
            kind: "cross_later",
            label: "營業日是當日、但在別天才結帳的單",
            detail: late.map((r) => `${r.no}（結帳 ${(r.c ?? "").slice(0, 16)}）`).join("、"),
        });
    }
    const earlier = db
        .prepare(
            `SELECT m_OrderNo AS no, m_WorkDate AS w FROM i_orders
             WHERE m_CloseTime >= ? AND m_CloseTime < ? AND m_WorkDate <> ? AND m_Checkout = 1`
        )
        .all(iso + " 00:00:00", posToIso(shiftDate(date, 1)) + " 00:00:00", date) as Array<{ no: string; w: string }>;
    if (earlier.length) {
        out.push({
            kind: "cross_earlier",
            label: "當天補結的舊單（營業日不是當日）",
            detail: earlier.map((r) => `${r.no}（營業日 ${r.w}）`).join("、"),
        });
    }
    return out;
}

export type DayOverview = {
    date: string;
    weekday: number;
    metrics: DayMetrics;
    firstSale: string | null;
    lastClose: string | null;
    minutes: number | null;
    z: ReturnType<typeof getZDay>;
};

function toMs(t: string): number {
    // 'YYYY-MM-DD HH:MM:SS.mmm'（台北本地時間；只做差，不需時區）
    const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(t);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function getDayOverview(date: string): DayOverview | null {
    const metrics = dayMetrics(date);
    if (!metrics) return null;
    const db = getYjcDb();
    const iso = posToIso(date);
    // 營業時長只用「當天開單、當天結帳」的單，避免跨日補結的單把時長拉到好幾天
    const t = db
        .prepare(
            `SELECT MIN(m_SaleTime) AS s, MAX(m_CloseTime) AS c FROM i_orders
             WHERE m_WorkDate = ? AND m_Checkout = 1 AND substr(m_SaleTime, 1, 10) = ? AND substr(m_CloseTime, 1, 10) = ?`
        )
        .get(date, iso, iso) as { s: string | null; c: string | null };
    let minutes: number | null = null;
    if (t.s && t.c) {
        const d = (toMs(t.c) - toMs(t.s)) / 60000;
        minutes = Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
    }
    return { date, weekday: weekdayOf(date), metrics, firstSale: t.s, lastClose: t.c, minutes, z: getZDay(date) };
}

export function getDayHours(date: string) {
    const iso = posToIso(date);
    return getHours({ from: iso, to: iso });
}
