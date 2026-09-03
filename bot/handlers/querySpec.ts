// ── 查詢引擎：QuerySpec → 結果文字 ────────────────────────────────
//
// 2026-09-03 查詢系統 v2（設計：vault projects/market-ledger/design/2026-09-03-query-system-v2）
//
// 一個引擎、兩個入口：按鈕點三下組出 QuerySpec，之後 LLM 也把問句翻成 QuerySpec，
// 底下都走這裡。這裡是查詢路徑上唯一碰 DB 的地方，而且只讀 —— 沒有任何寫入。
//
// 兩條執行路徑：
//   1. 委派：spec 剛好等於某個既有 handler 的特例（例如 revenue×day 就是 queryDailyRevenue），
//      直接呼叫它，保留那些已經打磨過的版型（單價換算、斤兩顯示…）。
//   2. 泛型：其餘組合走 fetchRows → group → format。指標×切法是乘法，
//      泛型路徑讓 160 種組合不用寫 160 個 handler。

import prisma from '../../src/lib/prisma';
import type { SessionData, DbContext } from '../types';
import { formatJinLiang } from '../../src/lib/units';
import {
    queryByDate, queryRecent, queryByMonthYear, queryDailyRevenue,
    queryByVendorMonth, queryByItemMonth, queryByExpenseTypeMonth,
    queryRanking, queryComparison,
} from './query';

// ── 型別 ────────────────────────────────────────────────────────

export type Metric = 'revenue' | 'purchase' | 'expense' | 'profit' | 'entries';
export type GroupBy = 'none' | 'day' | 'month' | 'location' | 'vendor' | 'item' | 'category' | 'expenseType' | 'note';
export type Agg = 'sum' | 'list';

export type Period = { from: Date; to: Date; label: string };

export type QuerySpec = {
    metric: Metric;
    period: Period;
    groupBy?: GroupBy;
    filters?: {
        locationId?: string;
        vendorId?: string;
        itemId?: string;
        expenseTypeValues?: string[];
        notePattern?: string;
    };
    agg?: Agg;
    topN?: number;
    compareTo?: Period;
};

// Telegram 單則訊息上限 4096 字；逐筆明細最多列這麼多行，其餘提示縮小範圍
const MAX_LIST_LINES = 60;

// ── 期間工具 ────────────────────────────────────────────────────

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

export function periodFromOffset(monthsBack: number): Period {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
    return { from, to, label: `${from.getFullYear()}年${from.getMonth() + 1}月` };
}

export function periodForDay(daysBack: number): Period {
    const from = new Date();
    from.setDate(from.getDate() - daysBack);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const tag = daysBack === 0 ? '今天' : daysBack === 1 ? '昨天' : daysBack === 2 ? '前天' : '';
    const md = `${from.getMonth() + 1}/${from.getDate()}`;
    return { from, to, label: tag ? `${tag}（${md}）` : md };
}

/** 週一起算的一週；weeksBack=0 本週 */
export function periodForWeek(weeksBack: number): Period {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dow = (now.getDay() + 6) % 7;          // 週一=0
    const from = new Date(now);
    from.setDate(now.getDate() - dow - weeksBack * 7);
    const to = new Date(from);
    to.setDate(from.getDate() + 7);
    const f = `${from.getMonth() + 1}/${from.getDate()}`;
    const endShown = new Date(to); endShown.setDate(endShown.getDate() - 1);
    const t = `${endShown.getMonth() + 1}/${endShown.getDate()}`;
    return { from, to, label: `${weeksBack === 0 ? '本週' : weeksBack === 1 ? '上週' : ''}（${f}~${t}）` };
}

export function periodForYear(yearsBack: number): Period {
    const y = new Date().getFullYear() - yearsBack;
    return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), label: `${y}年` };
}

/** 給選單用的期間代碼：d0 今天 / d1 昨天 / w0 本週 / w1 上週 / m0 本月 / m1 上月 / y0 今年 / y1 去年 */
export function periodFromCode(code: string): Period | null {
    const m = code.match(/^([dwmy])(\d+)$/);
    if (!m) return null;
    const n = Number(m[2]);
    switch (m[1]) {
        case 'd': return periodForDay(n);
        case 'w': return periodForWeek(n);
        case 'm': return periodFromOffset(n);
        case 'y': return periodForYear(n);
    }
    return null;
}

/** 期間可序列化版本（存進 ChatState 會走 JSON） */
export type PeriodJson = { fromIso: string; toIso: string; label: string };
export function periodToJson(p: Period): PeriodJson {
    return { fromIso: p.from.toISOString(), toIso: p.to.toISOString(), label: p.label };
}
export function periodFromJson(j: PeriodJson): Period {
    return { from: new Date(j.fromIso), to: new Date(j.toIso), label: j.label };
}

function isSingleDay(p: Period): boolean {
    return p.to.getTime() - p.from.getTime() <= 86400000 + 1000;
}

function isWholeMonth(p: Period): boolean {
    return p.from.getDate() === 1 && p.to.getDate() === 1 &&
        (p.to.getMonth() - p.from.getMonth() === 1 || (p.from.getMonth() === 11 && p.to.getMonth() === 0));
}

// ── 指標 / 切法 的顯示名 ────────────────────────────────────────

export const METRIC_LABEL: Record<Metric, string> = {
    revenue: '營業額', purchase: '進貨', expense: '支出', profit: '淨利', entries: '全部記錄',
};

export const GROUPBY_LABEL: Record<GroupBy, string> = {
    none: '總計', day: '每日', month: '每月', location: '依攤位', vendor: '依廠商',
    item: '依品項', category: '依分類', expenseType: '依類型', note: '依備註（人）',
};

/** 每個指標有意義的切法（選單第 3 步用）*/
export const GROUPBYS_FOR: Record<Metric, GroupBy[]> = {
    revenue:  ['day', 'location', 'month'],
    purchase: ['vendor', 'item', 'category', 'day', 'month'],
    expense:  ['expenseType', 'note', 'day', 'month'],
    profit:   ['none', 'day', 'month'],   // 不提供依攤位：進貨/支出沒有攤位，分不出成本
    entries:  ['none', 'day'],
};

// ── 資料列 ──────────────────────────────────────────────────────

type Row = {
    date: Date;
    amount: number;      // 已帶正負：profit 時進貨/支出為負
    kind: 'revenue' | 'purchase' | 'expense';
    location?: string;
    vendor?: string;
    item?: string;
    category?: string;
    expLabel?: string;
    note?: string;
    qty?: string;        // 進貨數量顯示用
    isDayOff?: boolean;
};

async function fetchRows(spec: QuerySpec, session: SessionData, ctx: DbContext): Promise<Row[]> {
    const { metric, period, filters = {} } = spec;
    const rows: Row[] = [];
    const wantRevenue = metric === 'revenue' || metric === 'profit' || metric === 'entries';
    const wantPurchase = metric === 'purchase' || metric === 'profit' || metric === 'entries';
    const wantExpense = metric === 'expense' || metric === 'profit' || metric === 'entries';
    const neg = metric === 'profit' ? -1 : 1;

    if (wantRevenue) {
        const where: Record<string, unknown> = { tenantId: session.tenantId, date: { gte: period.from, lt: period.to } };
        if (filters.locationId) where.locationId = filters.locationId;
        const revs = await prisma.revenue.findMany({ where, include: { location: true }, orderBy: { date: 'asc' } });
        for (const r of revs) {
            rows.push({ date: r.date, amount: r.isDayOff ? 0 : r.amount, kind: 'revenue',
                location: r.location?.name ?? '?', note: r.note ?? undefined, isDayOff: r.isDayOff });
        }
    }

    if (wantPurchase) {
        const where: Record<string, unknown> = { tenantId: session.tenantId, type: 'PURCHASE', date: { gte: period.from, lt: period.to } };
        if (filters.vendorId) where.vendorId = filters.vendorId;
        if (filters.itemId) where.itemId = filters.itemId;
        const ents = await prisma.entry.findMany({
            where, include: { item: { include: { category: true } }, vendor: true }, orderBy: { date: 'asc' },
        });
        for (const e of ents) {
            const qty = e.inputQuantity != null
                ? (e.inputUnit === 'jl'
                    ? formatJinLiang(e.inputQuantity)
                    : `${e.inputQuantity}${e.inputUnit ? (ctx.units.find(u => u.code === e.inputUnit)?.name ?? e.inputUnit) : ''}`)
                : undefined;
            rows.push({ date: e.date, amount: e.totalPrice * neg, kind: 'purchase',
                vendor: e.vendor?.name, item: e.item?.name ?? '?',
                category: e.item?.category?.name ?? '其他', note: e.note ?? undefined, qty });
        }
    }

    if (wantExpense) {
        const where: Record<string, unknown> = { tenantId: session.tenantId, type: 'EXPENSE', date: { gte: period.from, lt: period.to } };
        if (filters.expenseTypeValues?.length) {
            where.expenseType = filters.expenseTypeValues.length === 1 ? filters.expenseTypeValues[0] : { in: filters.expenseTypeValues };
        }
        if (filters.notePattern) where.note = { contains: filters.notePattern };
        const ents = await prisma.entry.findMany({ where, orderBy: { date: 'asc' } });
        for (const e of ents) {
            const raw = e.expenseType ?? '其他';
            rows.push({ date: e.date, amount: e.totalPrice * neg, kind: 'expense',
                expLabel: ctx.expenseTypes.find(x => x.value === raw)?.label ?? raw,
                note: e.note ?? undefined });
        }
    }

    return rows;
}

// ── 分組 ────────────────────────────────────────────────────────

function dayKey(d: Date): string {
    return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')} ${WEEKDAY[d.getDay()]}`;
}
function monthKey(d: Date): string {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function groupKey(row: Row, by: GroupBy): string {
    switch (by) {
        case 'day': return dayKey(row.date);
        case 'month': return monthKey(row.date);
        case 'location': return row.location ?? '（無攤位）';
        case 'vendor': return row.vendor ?? '（無廠商）';
        case 'item': return row.item ?? '?';
        case 'category': return row.category ?? '其他';
        case 'expenseType': return row.expLabel ?? '其他';
        case 'note': return row.note?.trim() || '（無備註）';
        default: return '__all__';
    }
}

type Group = { key: string; sum: number; count: number; rows: Row[]; byKind: Record<string, number> };

function groupRows(rows: Row[], by: GroupBy): Group[] {
    const map = new Map<string, Group>();
    for (const r of rows) {
        const k = groupKey(r, by);
        if (!map.has(k)) map.set(k, { key: k, sum: 0, count: 0, rows: [], byKind: {} });
        const g = map.get(k)!;
        g.sum += r.amount;
        g.count++;
        g.rows.push(r);
        g.byKind[r.kind] = (g.byKind[r.kind] ?? 0) + r.amount;
    }
    // day/month 依時間順序；其餘依金額（絕對值）由大到小
    const arr = [...map.values()];
    if (by === 'day' || by === 'month') return arr;   // Map 保留插入順序 = 日期升冪
    return arr.sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
}

// ── 格式化 ──────────────────────────────────────────────────────

const $ = (n: number) => `$${(Math.round(n) || 0).toLocaleString()}`;   // || 0 吃掉 -0

// 回覆第一行覆述「我理解成什麼」：期間 · 指標 · 篩選 · 切法。
// 使用者一眼看出有沒有誤解（設計原則：誤解要立刻可見，不要藏）。
function header(spec: QuerySpec, ctx: DbContext): string {
    const parts = [spec.period.label, METRIC_LABEL[spec.metric]];
    const f = spec.filters ?? {};
    if (f.locationId) parts.push(ctx.locations.find(l => l.id === f.locationId)?.name ?? '');
    if (f.vendorId) parts.push(ctx.vendors.find(v => v.id === f.vendorId)?.name ?? '');
    if (f.itemId) parts.push(ctx.items.find(i => i.id === f.itemId)?.name ?? '');
    if (f.expenseTypeValues?.length) parts.push(ctx.expenseTypes.find(x => f.expenseTypeValues!.includes(x.value))?.label ?? '');
    if (f.notePattern) parts.push(`備註「${f.notePattern}」`);
    const by = spec.groupBy && spec.groupBy !== 'none' ? GROUPBY_LABEL[spec.groupBy] : null;
    if (spec.agg === 'list') parts.push('逐筆明細');
    else if (by) parts.push(by);
    return `📊 ${parts.filter(Boolean).join(' · ')}`;
}

function describeRow(r: Row): string {
    const d = `${r.date.getMonth() + 1}/${r.date.getDate()}`;
    const note = r.note ? ` 備註：${r.note}` : '';
    if (r.kind === 'revenue') return `${d} ${r.location} ${r.isDayOff ? '公休' : $(r.amount)}${note}`;
    if (r.kind === 'purchase') return `${d} ${r.item} ${r.qty ? r.qty + ' ' : ''}${$(Math.abs(r.amount))}${r.vendor ? `（${r.vendor}）` : '（無廠商）'}${note}`;
    return `${d} ${r.expLabel} ${$(Math.abs(r.amount))}${note}`;
}

function formatList(spec: QuerySpec, rows: Row[], ctx: DbContext): string {
    const lines = [header(spec, ctx), ''];
    if (rows.length === 0) return `${lines[0]}\n\n此期間無記錄`;
    const shown = rows.slice(0, MAX_LIST_LINES);
    for (const r of shown) lines.push(`  • ${describeRow(r)}`);
    if (rows.length > shown.length) lines.push(`  …還有 ${rows.length - shown.length} 筆，縮小期間或加篩選再查`);
    lines.push('─────────────');
    const total = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
    lines.push(`合計 ${$(total)}（${rows.length} 筆）`);
    return lines.join('\n');
}

function formatGrouped(spec: QuerySpec, rows: Row[], ctx: DbContext): string {
    const by = spec.groupBy ?? 'none';
    const lines = [header(spec, ctx), ''];
    if (rows.length === 0) return `${lines[0]}\n\n此期間無記錄`;

    const groups = groupRows(rows, by);
    const isProfit = spec.metric === 'profit';
    const grand = rows.reduce((s, r) => s + r.amount, 0);

    if (by === 'none') {
        if (isProfit) {
            const rev = rows.filter(r => r.kind === 'revenue').reduce((s, r) => s + r.amount, 0);
            const pur = -rows.filter(r => r.kind === 'purchase').reduce((s, r) => s + r.amount, 0);
            const exp = -rows.filter(r => r.kind === 'expense').reduce((s, r) => s + r.amount, 0);
            lines.push(`💰 營業額 ${$(rev)}`);
            lines.push(`🛒 進貨 ${$(pur)}`);
            lines.push(`💸 支出 ${$(exp)}`);
            lines.push('─────────────');
            lines.push(`${grand >= 0 ? '💵 淨利' : '🔻 虧損'} ${$(Math.abs(grand))}`);
        } else {
            lines.push(`合計 ${$(Math.abs(grand))}（${rows.length} 筆）`);
        }
        return lines.join('\n');
    }

    // topN：只留前 N，其餘併成「其他」
    let shown = groups;
    let others: Group | null = null;
    if (spec.topN && groups.length > spec.topN && by !== 'day' && by !== 'month') {
        shown = groups.slice(0, spec.topN);
        const rest = groups.slice(spec.topN);
        others = { key: `其他 ${rest.length} 項`, sum: rest.reduce((s, g) => s + g.sum, 0),
            count: rest.reduce((s, g) => s + g.count, 0), rows: [], byKind: {} };
    }

    let openDays = 0, best: Group | null = null, worst: Group | null = null;
    for (const g of shown) {
        if (isProfit) {
            const rev = g.byKind.revenue ?? 0;
            const cost = -((g.byKind.purchase ?? 0) + (g.byKind.expense ?? 0));
            lines.push(`  ${g.key}  收 ${$(rev)} − 成本 ${$(cost)} = ${g.sum >= 0 ? '' : '−'}${$(Math.abs(g.sum))}`);
        } else if (by === 'day' && spec.metric === 'revenue') {
            const off = g.rows.filter(r => r.isDayOff).map(r => (r.location ?? '').replace('攤位', ''));
            const open = g.rows.filter(r => !r.isDayOff);
            if (open.length === 0) { lines.push(`  ${g.key}  公休（${off.join('、')}）`); continue; }
            const parts = open.map(r => `${(r.location ?? '').replace('攤位', '')} ${$(r.amount)}`);
            const suffix = open.length > 1 ? `  = ${$(g.sum)}` : '';
            lines.push(`  ${g.key}  ${parts.join(' ｜ ')}${off.length ? `（${off.join('、')}公休）` : ''}${suffix}`);
        } else {
            const share = grand !== 0 && by !== 'day' && by !== 'month' ? `  ${Math.round(Math.abs(g.sum) / Math.abs(grand) * 100)}%` : '';
            lines.push(`  ${g.key}  ${$(Math.abs(g.sum))}（${g.count} 筆）${share}`);
        }
        if (g.sum !== 0) {
            openDays++;
            if (!best || g.sum > best.sum) best = g;
            if (!worst || g.sum < worst.sum) worst = g;
        }
    }
    if (others) lines.push(`  ${others.key}  ${$(Math.abs(others.sum))}（${others.count} 筆）`);

    lines.push('─────────────');
    if (isProfit) {
        lines.push(`${grand >= 0 ? '💵 淨利' : '🔻 虧損'} ${$(Math.abs(grand))}`);
    } else {
        lines.push(`合計 ${$(Math.abs(grand))}（${rows.length} 筆）`);
    }
    if ((by === 'day' || by === 'month') && openDays > 1) {
        const unit = by === 'day' ? '天' : '個月';
        lines.push(`${by === 'day' ? '營業' : '共'} ${openDays} ${unit} ｜ 平均 ${$(Math.abs(grand) / openDays)}`);
        if (best && worst && best !== worst) {
            lines.push(`最高 ${best.key} ${$(Math.abs(best.sum))} ｜ 最低 ${worst.key} ${$(Math.abs(worst.sum))}`);
        }
    }
    return lines.join('\n');
}

function formatCompare(spec: QuerySpec, a: Row[], b: Row[]): string {
    const p2 = spec.compareTo!;
    const sumOf = (rows: Row[], kind?: Row['kind']) =>
        rows.filter(r => !kind || r.kind === kind).reduce((s, r) => s + r.amount, 0);
    const lines = [`📊 ${spec.period.label} vs ${p2.label} · ${METRIC_LABEL[spec.metric]}`, ''];
    const pairs: [string, number, number][] = [];
    if (spec.metric === 'profit') {
        pairs.push(['💰 營業額', sumOf(a, 'revenue'), sumOf(b, 'revenue')]);
        pairs.push(['🛒 進貨', -sumOf(a, 'purchase'), -sumOf(b, 'purchase')]);
        pairs.push(['💸 支出', -sumOf(a, 'expense'), -sumOf(b, 'expense')]);
        pairs.push(['💵 淨利', sumOf(a), sumOf(b)]);
    } else {
        pairs.push([METRIC_LABEL[spec.metric], Math.abs(sumOf(a)), Math.abs(sumOf(b))]);
    }
    for (const [label, x, y] of pairs) {
        const diff = x - y;
        const pct = y !== 0 ? ` (${diff >= 0 ? '+' : ''}${Math.round(diff / Math.abs(y) * 100)}%)` : '';
        lines.push(`${label}`);
        lines.push(`  ${spec.period.label} ${$(x)}`);
        lines.push(`  ${p2.label} ${$(y)}`);
        lines.push(`  差 ${diff >= 0 ? '+' : '−'}${$(Math.abs(diff))}${pct}`);
    }
    return lines.join('\n');
}

// ── 入口 ────────────────────────────────────────────────────────

/**
 * 執行 QuerySpec。先看能不能委派給既有的精緻 handler，不行才走泛型路徑。
 * 這裡沒有任何寫入。
 */
export async function runQuery(spec: QuerySpec, session: SessionData, ctx: DbContext): Promise<string> {
    const f = spec.filters ?? {};
    const by = spec.groupBy ?? 'none';

    // ── 委派：既有 handler 的特例 ──────────────────────────────
    if (spec.compareTo && spec.metric === 'profit' && by === 'none') {
        return queryComparison(spec.period, spec.compareTo, session, ctx);
    }
    if (spec.metric === 'entries' && isSingleDay(spec.period)) {
        return queryByDate(spec.period.from, session, ctx);
    }
    if (spec.metric === 'entries' && by === 'day' && !isWholeMonth(spec.period)
        && spec.period.to.getTime() - spec.period.from.getTime() <= 8 * 86400000) {
        return queryRecent(session, ctx);
    }
    if (spec.metric === 'revenue' && by === 'day') {
        const locName = f.locationId ? ctx.locations.find(l => l.id === f.locationId)?.name : undefined;
        return queryDailyRevenue(spec.period, f.locationId, locName, session, ctx);
    }
    if (spec.metric === 'purchase' && f.vendorId && by === 'item' && isWholeMonth(spec.period)) {
        const v = ctx.vendors.find(x => x.id === f.vendorId);
        if (v) return queryByVendorMonth(v.name, spec.period.from.getMonth() + 1, spec.period.from.getFullYear(), session, ctx);
    }
    if (spec.metric === 'purchase' && f.itemId && by === 'vendor') {
        const it = ctx.items.find(x => x.id === f.itemId);
        if (it) return queryByItemMonth(it.id, it.name, spec.period, session, ctx);
    }
    if (spec.metric === 'expense' && f.expenseTypeValues?.length && spec.agg === 'list' && !f.notePattern) {
        const label = ctx.expenseTypes.find(x => f.expenseTypeValues!.includes(x.value))?.label ?? f.expenseTypeValues[0];
        return queryByExpenseTypeMonth(f.expenseTypeValues, label, spec.period, session, ctx);
    }
    if (spec.topN && by !== 'none' && by !== 'day' && by !== 'month' && !f.vendorId && !f.itemId
        && (by === 'vendor' || by === 'item' || by === 'location')
        && (spec.metric === 'purchase' || spec.metric === 'revenue')) {
        return queryRanking(spec.period, by, spec.topN, session, ctx);
    }
    if ((spec.metric === 'revenue' || spec.metric === 'purchase' || spec.metric === 'expense')
        && by === 'none' && spec.agg !== 'list' && !spec.compareTo && Object.keys(f).length === 0) {
        return queryByMonthYear(spec.period, spec.metric, session, ctx);
    }
    if ((spec.metric === 'profit' || spec.metric === 'entries') && by === 'none' && !spec.compareTo) {
        return queryByMonthYear(spec.period, undefined, session, ctx);
    }

    // ── 泛型 ──────────────────────────────────────────────────
    const rows = await fetchRows(spec, session, ctx);
    if (spec.compareTo) {
        const rowsB = await fetchRows({ ...spec, period: spec.compareTo, compareTo: undefined }, session, ctx);
        return formatCompare(spec, rows, rowsB);
    }
    if (spec.agg === 'list') return formatList(spec, rows, ctx);
    return formatGrouped(spec, rows, ctx);
}

/** 支出「依類型」／「依人」的分組摘要，選單用來做下鑽按鈕 */
export async function expenseGroups(
    spec: QuerySpec, by: 'expenseType' | 'note', session: SessionData, ctx: DbContext,
): Promise<{ key: string; sum: number; count: number; values: string[] }[]> {
    const rows = await fetchRows({ ...spec, metric: 'expense' }, session, ctx);
    const groups = groupRows(rows, by);
    return groups.map(g => ({
        key: g.key, sum: g.sum, count: g.count,
        // 依類型時，把同 label 的所有 value 帶回去（租金＝rent/EXP001）
        values: by === 'expenseType'
            ? ctx.expenseTypes.filter(x => x.label === g.key).map(x => x.value)
            : [],
    }));
}
