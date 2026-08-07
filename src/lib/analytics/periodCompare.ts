// 分析 #6：月環比（MoM）/ 去年同期（YoY）— 營收、支出、各分類。
//
// 🔴 誠實面對限制：資料庫最早的營業資料是 2026-01（少數 2001 年是資料錄入年份打錯，
// 屬於異常值，見 anomalies.ts 案例 3，本模組直接排除年份 < 2020 的紀錄避免污染統計）。
// 所以任何 2026 年月份的 YoY（去年同期 = 2025 年同月）目前一定沒有資料可比較，
// 回傳 yoyAvailable=false + yoyReason，而不是靜默回傳 0 或誤導的假比較。

import prisma from '@/lib/prisma';
import { STALLS, type StallCode } from './stallInference';
import { addMonthsUTC, monthKeyUTC, monthRangeUTC } from './dateRange';

const MIN_VALID_YEAR = 2020; // 資料庫已知有極少數 2001 年輸入錯誤的髒資料，統計時排除

export interface PeriodCompareParams {
    tenantId: string;
    /** 'YYYY-MM'，預設本月（UTC 基準） */
    month?: string;
}

export interface CategoryAmount {
    key: string; // expenseType value，或 'purchase' 代表進貨
    label: string;
    amount: number;
    count: number;
}

export interface PeriodMetrics {
    month: string;
    revenueTotal: number;
    revenueByStall: Record<StallCode, number>;
    purchaseTotal: number;
    expenseTotal: number; // 不含進貨
    expenseByCategory: CategoryAmount[];
    totalCost: number; // purchaseTotal + expenseTotal
    profit: number; // revenueTotal - totalCost
}

export interface DeltaBlock {
    revenueDeltaPct: number | null;
    totalCostDeltaPct: number | null;
    profitDelta: number | null;
}

export interface PeriodCompareResult {
    current: PeriodMetrics;
    mom: { previous: PeriodMetrics; delta: DeltaBlock } | null;
    yoy: { previous: PeriodMetrics; delta: DeltaBlock } | null;
    yoyReason: string | null;
}

async function computeMonthMetrics(tenantId: string, year: number, month: number): Promise<PeriodMetrics> {
    const range = monthRangeUTC(year, month);
    const monthKey = monthKeyUTC(range.gte);

    const [revenues, entries, expenseTypeDict] = await Promise.all([
        prisma.revenue.findMany({
            where: { tenantId, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
            include: { location: true },
        }),
        prisma.entry.findMany({
            where: { tenantId, date: { gte: range.gte, lt: range.lt } },
        }),
        prisma.dictionary.findMany({ where: { tenantId, category: 'expense_type' } }),
    ]);

    const expenseLabelMap = new Map(expenseTypeDict.map((d) => [d.value, d.label]));

    const revenueByStall: Record<StallCode, number> = { pingtung: 0, chaozhou: 0 };
    let revenueTotal = 0;
    for (const r of revenues) {
        if (r.date.getUTCFullYear() < MIN_VALID_YEAR) continue;
        const stall = STALLS.find((s) => s.locationName === r.location?.name);
        if (stall) revenueByStall[stall.code] += r.amount;
        revenueTotal += r.amount;
    }

    let purchaseTotal = 0;
    let expenseTotal = 0;
    const categoryMap = new Map<string, CategoryAmount>();

    for (const e of entries) {
        if (e.date.getUTCFullYear() < MIN_VALID_YEAR) continue;
        if (e.type === 'PURCHASE') {
            purchaseTotal += e.totalPrice;
        } else if (e.type === 'EXPENSE') {
            expenseTotal += e.totalPrice;
            const key = e.expenseType ?? 'unknown';
            const label = expenseLabelMap.get(key) ?? key;
            if (!categoryMap.has(key)) categoryMap.set(key, { key, label, amount: 0, count: 0 });
            const bucket = categoryMap.get(key)!;
            bucket.amount += e.totalPrice;
            bucket.count += 1;
        }
    }

    const expenseByCategory = [...categoryMap.values()].sort((a, b) => b.amount - a.amount);
    const totalCost = purchaseTotal + expenseTotal;

    return {
        month: monthKey,
        revenueTotal,
        revenueByStall,
        purchaseTotal,
        expenseTotal,
        expenseByCategory,
        totalCost,
        profit: revenueTotal - totalCost,
    };
}

function pctDelta(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null; // 分母為 0 時百分比沒有意義
    return ((current - previous) / previous) * 100;
}

function computeDelta(current: PeriodMetrics, previous: PeriodMetrics): DeltaBlock {
    return {
        revenueDeltaPct: pctDelta(current.revenueTotal, previous.revenueTotal),
        totalCostDeltaPct: pctDelta(current.totalCost, previous.totalCost),
        profitDelta: current.profit - previous.profit,
    };
}

export async function getPeriodComparison(params: PeriodCompareParams): Promise<PeriodCompareResult> {
    const { tenantId } = params;
    const now = new Date();
    const targetMonthDate = params.month
        ? new Date(Date.UTC(Number(params.month.slice(0, 4)), Number(params.month.slice(5, 7)) - 1, 1))
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const year = targetMonthDate.getUTCFullYear();
    const month = targetMonthDate.getUTCMonth() + 1;

    const current = await computeMonthMetrics(tenantId, year, month);

    const prevMonthDate = addMonthsUTC(targetMonthDate, -1);
    const momPrevious = await computeMonthMetrics(tenantId, prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth() + 1);
    const mom = { previous: momPrevious, delta: computeDelta(current, momPrevious) };

    let yoy: PeriodCompareResult['yoy'] = null;
    let yoyReason: string | null = null;
    const yoyYear = year - 1;
    if (yoyYear < MIN_VALID_YEAR) {
        yoyReason = `去年同期（${yoyYear}-${String(month).padStart(2, '0')}）早於資料庫最早有效資料年份（${MIN_VALID_YEAR}），無資料可比較`;
    } else {
        const yoyPrevious = await computeMonthMetrics(tenantId, yoyYear, month);
        if (yoyPrevious.revenueTotal === 0 && yoyPrevious.totalCost === 0) {
            yoyReason = `${yoyPrevious.month} 無任何營收/支出紀錄，視為無去年同期資料`;
        } else {
            yoy = { previous: yoyPrevious, delta: computeDelta(current, yoyPrevious) };
        }
    }

    return { current, mom, yoy, yoyReason };
}
