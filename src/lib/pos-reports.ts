// POS 報表：資料健康列、日報（Z 帳）對帳、時段銷售、營業月報。
//
// 口徑（owner 決定）：營業日一律用 i_orders.m_WorkDate（與 POS 的 Z 帳一致），不用結帳日曆日。
// 只計 m_Checkout = 1 的單。單據總額用 m_Total（折扣前，等於 Z 帳「銷售總額」）。
// i_ShiftTotal：z_shift = '@' 是全日合計（Z 帳），z_value 是字串。

import { getYjcDb, getLastImportAt, listTableColumns } from "@/lib/yjc-db";
import { type DateRange, toPosDate } from "@/lib/pos-queries";

function has(table: string, ...cols: string[]): boolean {
    const have = listTableColumns(table);
    return have.length > 0 && cols.every((c) => have.includes(c));
}

/** Z 帳的值是字串（可能有千分位、可能是空字串）。 */
export function parseZNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/,/g, "").trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
export function weekdayName(i: number): string {
    return WEEKDAYS[i] ?? "";
}

/** 'YYYY/MM/DD' 或 'YYYY-MM-DD' -> 0(日)..6(六) */
export function weekdayOf(date: string): number {
    const [y, m, d] = date.split(/[/-]/).map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'YYYY/MM/DD' -> 'YYMMDD'（單號前綴） */
export function orderPrefix(workDate: string): string {
    const [y, m, d] = workDate.split("/");
    return `${y.slice(2)}${m}${d}`;
}

function closeDay(closeTime: string | null): string {
    return (closeTime ?? "").slice(0, 10).replace(/-/g, "/");
}

// ---------------------------------------------------------------------------
// 資料健康列

export type HealthStatus = "pass" | "attention" | "pending" | "info";

export type HealthCheck = {
    key: string;
    label: string;
    status: HealthStatus;
    value: string;
    note?: string;
};

export type Health = {
    workDate: string;
    orders: number;
    total: number;
    lastClose: string | null;
    checks: HealthCheck[];
    tables: Array<{ table: string; rows: number }>;
    lastImportAt: string | null;
};

const HEALTH_TABLES = [
    "i_orders",
    "i_items",
    "i_checks",
    "i_ShiftTotal",
    "i_ordersDelete",
    "i_itemsDelete",
    "i_shiftOpLog",
    "i_food",
];

function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
}

export function getLatestWorkDate(): string | null {
    if (!has("i_orders", "m_WorkDate")) return null;
    const r = getYjcDb().prepare(`SELECT MAX(m_WorkDate) AS d FROM i_orders`).get() as { d: string | null };
    return r.d;
}

/** 流水號檢查：回傳筆數、最大流水、缺號與其中被 POS 作廢單解釋掉的號碼。 */
export function checkSequence(workDate: string) {
    const db = getYjcDb();
    const prefix = orderPrefix(workDate);
    const rows = db
        .prepare(`SELECT m_OrderNo AS no FROM i_orders WHERE m_OrderNo GLOB ?`)
        .all(`${prefix}A[0-9][0-9][0-9][0-9]`) as Array<{ no: string }>;
    const serials = new Set(rows.map((r) => Number(r.no.slice(7, 11))));
    const max = serials.size ? Math.max(...serials) : 0;
    const gaps: number[] = [];
    for (let i = 1; i <= max; i++) if (!serials.has(i)) gaps.push(i);

    const explained: number[] = [];
    if (gaps.length && has("i_ordersDelete", "m_OrderNo")) {
        const del = db
            .prepare(`SELECT m_OrderNo AS no FROM i_ordersDelete WHERE m_OrderNo GLOB ?`)
            .all(`${prefix}A[0-9][0-9][0-9][0-9]`) as Array<{ no: string }>;
        const delSerials = new Set(del.map((r) => Number(r.no.slice(7, 11))));
        for (const g of gaps) if (delSerials.has(g)) explained.push(g);
    }
    return { count: serials.size, max, gaps, explained };
}

export type ZSummary = { count: number | null; total: number | null; hasZ: boolean };

export function getZSummary(workDate: string): ZSummary {
    if (!has("i_ShiftTotal", "z_workdate", "z_shift", "z_name", "z_value")) {
        return { count: null, total: null, hasZ: false };
    }
    const rows = getYjcDb()
        .prepare(
            `SELECT z_name AS n, z_value AS v FROM i_ShiftTotal
             WHERE z_workdate = ? AND z_shift = '@' AND z_name IN ('結帳數', '銷售總額')`
        )
        .all(workDate) as Array<{ n: string; v: string }>;
    const any = getYjcDb()
        .prepare(`SELECT COUNT(*) AS c FROM i_ShiftTotal WHERE z_workdate = ? AND z_shift = '@'`)
        .get(workDate) as { c: number };
    const get = (name: string) => {
        const r = rows.find((x) => x.n === name);
        return r ? parseZNumber(r.v) : null;
    };
    return { count: get("結帳數"), total: get("銷售總額"), hasZ: any.c > 0 };
}

export function getHealth(): Health | null {
    const workDate = getLatestWorkDate();
    if (!workDate) return null;
    const db = getYjcDb();

    const day = db
        .prepare(
            `SELECT COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t, MAX(m_CloseTime) AS lc
             FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1`
        )
        .get(workDate) as { n: number; t: number; lc: string | null };

    const checks: HealthCheck[] = [];

    checks.push({
        key: "last_close",
        label: "最後一張單結帳時間",
        status: "info",
        value: day.lc ? day.lc.slice(0, 19) : "無",
        note: "營業日 " + workDate,
    });
    checks.push({
        key: "day_total",
        label: "該營業日單數與營收",
        status: day.n > 0 ? "info" : "attention",
        value: `${day.n} 單 / ${fmt(day.t)}`,
    });

    // 流水號連續性
    const seq = checkSequence(workDate);
    if (seq.gaps.length === 0) {
        checks.push({
            key: "sequence",
            label: "流水號連續性",
            status: "pass",
            value: `${seq.count} 筆 = 最大流水 ${seq.max}`,
        });
    } else {
        const unexplained = seq.gaps.filter((g) => !seq.explained.includes(g));
        const list = (a: number[]) => a.slice(0, 8).map((g) => String(g).padStart(4, "0")).join("、");
        checks.push({
            key: "sequence",
            label: "流水號連續性",
            status: unexplained.length === 0 ? "pass" : "attention",
            value: `${seq.count} 筆，最大流水 ${seq.max}，缺 ${seq.gaps.length} 號`,
            note:
                unexplained.length === 0
                    ? `缺號皆為 POS 作廢單（${list(seq.explained)}）`
                    : `缺號 ${list(unexplained)}${unexplained.length > 8 ? " 等" : ""}，可能漏同步或單據被刪除`,
        });
    }

    // 與 Z 帳對帳
    const z = getZSummary(workDate);
    if (!z.hasZ) {
        checks.push({
            key: "z_recon",
            label: "與 Z 帳對帳",
            status: "pending",
            value: "今日尚未日結",
            note: "POS 約 18:47-18:57 自動日結，日結後才能對帳",
        });
    } else if (z.count === null || z.total === null) {
        checks.push({
            key: "z_recon",
            label: "與 Z 帳對帳",
            status: "attention",
            value: "Z 帳缺少「結帳數」或「銷售總額」",
        });
    } else {
        const okCount = z.count === day.n;
        const okTotal = Math.abs(z.total - day.t) < 0.5;
        if (okCount && okTotal) {
            checks.push({
                key: "z_recon",
                label: "與 Z 帳對帳",
                status: "pass",
                value: `Z 帳 ${z.count} 單 / ${fmt(z.total)}，相符`,
            });
        } else {
            const late = lateClosedCount(workDate);
            checks.push({
                key: "z_recon",
                label: "與 Z 帳對帳",
                status: "attention",
                value: `Z 帳 ${z.count} 單 / ${fmt(z.total)}；單據 ${day.n} 單 / ${fmt(day.t)}`,
                note:
                    late > 0
                        ? `有 ${late} 張單是日結後才結帳（常見原因），下次日結才會算進去`
                        : "差異原因不明，請到「日報（Z 帳）」查看",
            });
        }
    }

    // 最近一次日結
    if (has("i_shiftOpLog", "op_time", "op_Shifttype", "op_workdate")) {
        const lastZ = db
            .prepare(
                `SELECT op_time AS t, op_workdate AS d FROM i_shiftOpLog
                 WHERE op_Shifttype = 'Z' ORDER BY op_time DESC LIMIT 1`
            )
            .get() as { t: string; d: string } | undefined;
        if (lastZ) {
            checks.push({
                key: "last_z",
                label: "最近一次日結",
                status: "info",
                value: lastZ.t.slice(0, 19),
                note: "營業日 " + lastZ.d,
            });
        }
    }

    // 異常提示
    const returns = (db
        .prepare(`SELECT COUNT(*) AS c FROM i_orders WHERE m_WorkDate = ? AND m_OrderNo LIKE '%#'`)
        .get(workDate) as { c: number }).c;
    const unchecked = (db.prepare(`SELECT COUNT(*) AS c FROM i_orders WHERE m_Checkout <> 1`).get() as { c: number }).c;
    const flags: string[] = [];
    if (returns > 0) flags.push(`當日退貨單 ${returns} 張`);
    if (unchecked > 0) flags.push(`未結帳單 ${unchecked} 張`);
    checks.push({
        key: "anomaly",
        label: "異常提示",
        status: flags.length ? "attention" : "pass",
        value: flags.length ? flags.join("，") : "無退貨、無未結單",
    });

    const tables = HEALTH_TABLES.filter((t) => has(t)).map((t) => ({
        table: t,
        rows: (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c,
    }));

    return {
        workDate,
        orders: day.n,
        total: day.t,
        lastClose: day.lc,
        checks,
        tables,
        lastImportAt: getLastImportAt(),
    };
}

/** 結帳日曆日是 workDate、但營業日不是 workDate 的單（補結舊單）張數。 */
function earlierClosedCount(workDate: string): number {
    const [y, m, d] = workDate.split("/").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
    const iso = workDate.split("/").join("-");
    const r = getYjcDb()
        .prepare(
            `SELECT COUNT(*) AS c FROM i_orders
             WHERE m_Checkout = 1 AND m_CloseTime >= ? AND m_CloseTime < ? AND m_WorkDate <> ?`
        )
        .get(iso + " 00:00:00", next + " 00:00:00", workDate) as { c: number };
    return r.c;
}

/** 營業日 workDate 的單中，結帳時間晚於該日 Z 日結時間的張數。 */
function lateClosedCount(workDate: string): number {
    if (!has("i_shiftOpLog", "op_time", "op_Shifttype", "op_workdate")) return 0;
    const db = getYjcDb();
    const z = db
        .prepare(`SELECT MAX(op_time) AS t FROM i_shiftOpLog WHERE op_Shifttype = 'Z' AND op_workdate = ?`)
        .get(workDate) as { t: string | null };
    if (!z.t) return 0;
    const r = db
        .prepare(`SELECT COUNT(*) AS c FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1 AND m_CloseTime > ?`)
        .get(workDate, z.t) as { c: number };
    return r.c;
}

// ---------------------------------------------------------------------------
// 日報（Z 帳）

export type ZLine = {
    name: string;
    value: string;
    computed: number | null; // 由 i_orders 算出的對照值（沒有對照的列為 null）
    match: boolean | null;
};

export type ZDay = {
    date: string;
    hasZ: boolean;
    lines: ZLine[];
    orders: { count: number; total: number; pay: number };
};

export function getOrderDayTotals(workDate: string) {
    const r = getYjcDb()
        .prepare(
            `SELECT COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t, COALESCE(SUM(m_PayTotal), 0) AS p
             FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1`
        )
        .get(workDate) as { n: number; t: number; p: number };
    return { count: r.n, total: r.t, pay: r.p };
}

export function getZDay(workDate: string): ZDay {
    const orders = has("i_orders") ? getOrderDayTotals(workDate) : { count: 0, total: 0, pay: 0 };
    if (!has("i_ShiftTotal", "z_workdate", "z_shift", "z_name", "z_value")) {
        return { date: workDate, hasZ: false, lines: [], orders };
    }
    const rows = getYjcDb()
        .prepare(
            `SELECT z_name AS n, z_value AS v FROM i_ShiftTotal
             WHERE z_workdate = ? AND z_shift = '@' ORDER BY z_id`
        )
        .all(workDate) as Array<{ n: string; v: string | null }>;

    const compare = (name: string, value: string | null): number | null => {
        if (name === "結帳數") return orders.count;
        if (name === "銷售總額") return orders.total;
        if (name === "銷售淨額" || name === "營業收入") return orders.pay;
        if (name.startsWith("單數:")) return orders.total; // 名稱帶單數、值是銷售金額
        void value;
        return null;
    };

    const lines: ZLine[] = rows.map((r) => {
        const value = r.v ?? "";
        const computed = compare(r.n, value);
        let match: boolean | null = null;
        if (computed !== null) {
            if (r.n.startsWith("單數:")) {
                const m = /單數:(\d+)/.exec(r.n);
                const zv = parseZNumber(value);
                match = !!m && Number(m[1]) === orders.count && zv !== null && Math.abs(zv - orders.total) < 0.5;
            } else {
                const zv = parseZNumber(value);
                match = zv !== null && Math.abs(zv - computed) < 0.5;
            }
        }
        return { name: r.n, value, computed, match };
    });
    return { date: workDate, hasZ: rows.length > 0, lines, orders };
}

export type ZRangeRow = {
    date: string;
    zCount: number | null;
    zTotal: number | null;
    count: number;
    total: number;
    status: "match" | "mismatch" | "pending" | "no_z";
    note: string;
};

export function getZRange(range: DateRange, onlyBad: boolean): ZRangeRow[] {
    if (!has("i_orders", "m_WorkDate")) return [];
    const db = getYjcDb();
    const where: string[] = [];
    const params: string[] = [];
    if (range.from) {
        where.push("m_WorkDate >= ?");
        params.push(toPosDate(range.from));
    }
    if (range.to) {
        where.push("m_WorkDate <= ?");
        params.push(toPosDate(range.to));
    }
    const ordersBy = db
        .prepare(
            `SELECT m_WorkDate AS d, COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t
             FROM i_orders WHERE m_Checkout = 1${where.length ? " AND " + where.join(" AND ") : ""}
             GROUP BY m_WorkDate`
        )
        .all(...params) as Array<{ d: string; n: number; t: number }>;

    const zWhere = where.map((w) => w.replace("m_WorkDate", "z_workdate"));
    const zBy = has("i_ShiftTotal", "z_workdate", "z_shift", "z_name", "z_value")
        ? (db
              .prepare(
                  `SELECT z_workdate AS d,
                          MAX(CASE WHEN z_name = '結帳數' THEN z_value END) AS zc,
                          MAX(CASE WHEN z_name = '銷售總額' THEN z_value END) AS zt
                   FROM i_ShiftTotal WHERE z_shift = '@'${zWhere.length ? " AND " + zWhere.join(" AND ") : ""}
                   GROUP BY z_workdate`
              )
              .all(...params) as Array<{ d: string; zc: string | null; zt: string | null }>)
        : [];

    const zMap = new Map(zBy.map((r) => [r.d, r]));
    const oMap = new Map(ordersBy.map((r) => [r.d, r]));
    const dates = Array.from(new Set([...zMap.keys(), ...oMap.keys()])).sort().reverse();
    const latest = getLatestWorkDate();

    const out: ZRangeRow[] = dates.map((d) => {
        const o = oMap.get(d);
        const z = zMap.get(d);
        const count = o?.n ?? 0;
        const total = o?.t ?? 0;
        if (!z) {
            const open = d === latest;
            return {
                date: d,
                zCount: null,
                zTotal: null,
                count,
                total,
                status: open ? "pending" : "no_z",
                note: open ? "今日尚未日結" : "沒有 Z 帳",
            };
        }
        const zc = parseZNumber(z.zc);
        const zt = parseZNumber(z.zt);
        const same = zc === count && zt !== null && Math.abs(zt - total) < 0.5;
        let note = "";
        if (!same) {
            const late = lateClosedCount(d);
            const cross = (db
                .prepare(`SELECT m_CloseTime AS c FROM i_orders WHERE m_WorkDate = ? AND m_Checkout = 1`)
                .all(d) as Array<{ c: string | null }>).filter((r) => closeDay(r.c) !== d).length;
            const parts: string[] = [];
            if (late > 0) parts.push(`${late} 張單日結後才結帳`);
            if (cross > 0) parts.push(`${cross} 張單在別天才結帳`);
            const earlier = earlierClosedCount(d);
            if (earlier > 0) parts.push(`${earlier} 張別的營業日的單在這天補結`);
            note = parts.join("，") || "原因不明";
        }
        return { date: d, zCount: zc, zTotal: zt, count, total, status: same ? "match" : "mismatch", note };
    });
    return onlyBad ? out.filter((r) => r.status === "mismatch" || r.status === "no_z") : out;
}

export function getZDates(limit = 400): string[] {
    if (!has("i_ShiftTotal", "z_workdate", "z_shift")) return [];
    return (
        getYjcDb()
            .prepare(`SELECT DISTINCT z_workdate AS d FROM i_ShiftTotal WHERE z_shift = '@' ORDER BY d DESC LIMIT ?`)
            .all(limit) as Array<{ d: string }>
    ).map((r) => r.d);
}

// ---------------------------------------------------------------------------
// 時段銷售（依結帳時間的小時）

export type HourRow = { hour: number; orders: number; total: number; avg: number; shareOrders: number; shareTotal: number };

export function getHours(range: DateRange) {
    if (!has("i_orders", "m_CloseTime")) return { rows: [] as HourRow[], orders: 0, total: 0, noTime: 0 };
    const where: string[] = [];
    const params: string[] = [];
    if (range.from) {
        where.push("m_WorkDate >= ?");
        params.push(toPosDate(range.from));
    }
    if (range.to) {
        where.push("m_WorkDate <= ?");
        params.push(toPosDate(range.to));
    }
    const w = where.length ? " AND " + where.join(" AND ") : "";
    const db = getYjcDb();
    const raw = db
        .prepare(
            `SELECT CAST(substr(m_CloseTime, 12, 2) AS INTEGER) AS h, COUNT(*) AS n, COALESCE(SUM(m_Total), 0) AS t
             FROM i_orders WHERE m_Checkout = 1 AND length(m_CloseTime) >= 13${w}
             GROUP BY h ORDER BY h`
        )
        .all(...params) as Array<{ h: number; n: number; t: number }>;
    const noTime = (db
        .prepare(`SELECT COUNT(*) AS c FROM i_orders WHERE m_Checkout = 1 AND (m_CloseTime IS NULL OR length(m_CloseTime) < 13)${w}`)
        .get(...params) as { c: number }).c;
    const orders = raw.reduce((a, r) => a + r.n, 0);
    const total = raw.reduce((a, r) => a + r.t, 0);
    const rows = raw.map((r) => ({
        hour: r.h,
        orders: r.n,
        total: r.t,
        avg: r.n ? r.t / r.n : 0,
        shareOrders: orders ? r.n / orders : 0,
        shareTotal: total ? r.t / total : 0,
    }));
    return { rows, orders, total, noTime };
}

// ---------------------------------------------------------------------------
// 營業月報

export type DayRow = { date: string; orders: number; total: number };

export function listMonths(): string[] {
    if (!has("i_orders", "m_WorkDate")) return [];
    return (
        getYjcDb()
            .prepare(
                `SELECT DISTINCT substr(m_WorkDate, 1, 7) AS m FROM i_orders WHERE m_Checkout = 1 ORDER BY m DESC`
            )
            .all() as Array<{ m: string }>
    ).map((r) => r.m);
}

export type WeekdayStat = { weekday: number; days: number; avgTotal: number; avgOrders: number };

export function weekdayStats(days: DayRow[]): WeekdayStat[] {
    const acc = Array.from({ length: 7 }, () => ({ days: 0, total: 0, orders: 0 }));
    for (const d of days) {
        const w = weekdayOf(d.date);
        acc[w].days += 1;
        acc[w].total += d.total;
        acc[w].orders += d.orders;
    }
    return acc.map((a, i) => ({
        weekday: i,
        days: a.days,
        avgTotal: a.days ? a.total / a.days : 0,
        avgOrders: a.days ? a.orders / a.days : 0,
    }));
}

function dayRows(monthPrefix: string | null): DayRow[] {
    const db = getYjcDb();
    const sql =
        `SELECT m_WorkDate AS date, COUNT(*) AS orders, COALESCE(SUM(m_Total), 0) AS total
         FROM i_orders WHERE m_Checkout = 1` +
        (monthPrefix ? ` AND m_WorkDate >= ? AND m_WorkDate <= ?` : ``) +
        ` GROUP BY m_WorkDate ORDER BY m_WorkDate`;
    return (monthPrefix
        ? db.prepare(sql).all(`${monthPrefix}/01`, `${monthPrefix}/31`)
        : db.prepare(sql).all()) as DayRow[];
}

export function getMonthly(month: string) {
    // month: 'YYYY/MM'
    if (!has("i_orders", "m_WorkDate")) return null;
    const days = dayRows(month);
    const orders = days.reduce((a, d) => a + d.orders, 0);
    const total = days.reduce((a, d) => a + d.total, 0);
    const monthStats = weekdayStats(days);
    const allStats = weekdayStats(dayRows(null));
    return {
        month,
        days,
        orders,
        total,
        openDays: days.length,
        avgOrder: orders ? total / orders : 0,
        avgDay: days.length ? total / days.length : 0,
        maxDayTotal: days.reduce((a, d) => Math.max(a, d.total), 0),
        monthStats,
        allStats,
    };
}
