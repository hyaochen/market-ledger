// 分析 #4：品項價格趨勢 — 某品項的月均單價變化（抓漲價），處理單位不一致。

import prisma from '@/lib/prisma';
import { resolveItemsByQuery } from './itemResolve';
import { normalizeToKgPrice } from './priceNormalize';
import { monthKeyUTC, resolveRange } from './dateRange';

export interface PriceTrendParams {
    tenantId: string;
    query?: string;
    itemId?: string;
    from?: string | null;
    to?: string | null;
}

export interface PriceTrendMonth {
    month: string; // 'YYYY-MM'
    count: number;
    avgPricePerKg: number;
    minPricePerKg: number;
    maxPricePerKg: number;
    /** 相對上個「有資料」月份的漲跌幅 %，第一個有資料月份為 null */
    momChangePct: number | null;
}

export interface PriceTrendResult {
    range: { from: string; to: string };
    matchedItems: { id: string; name: string; score: number }[];
    months: PriceTrendMonth[];
    /** 區間內最大單月漲幅（用來快速標「疑似漲價」） */
    biggestJump: { month: string; momChangePct: number } | null;
    excludedNonWeightCount: number;
}

export async function getItemPriceTrend(params: PriceTrendParams): Promise<PriceTrendResult> {
    const { tenantId } = params;
    // 趨勢分析預設看比較長的區間（1 年），跟搜尋類 API 的預設不同
    const range = resolveRange(params.from, params.to, 365);

    const matchedItems = params.query || params.itemId
        ? await resolveItemsByQuery(tenantId, params.query ?? '', { itemId: params.itemId })
        : [];

    const empty: PriceTrendResult = {
        range: { from: range.fromKey, to: range.toKey },
        matchedItems: matchedItems.map((i) => ({ id: i.id, name: i.name, score: i.score })),
        months: [],
        biggestJump: null,
        excludedNonWeightCount: 0,
    };
    if (matchedItems.length === 0) return empty;

    const entries = await prisma.entry.findMany({
        where: {
            tenantId,
            type: 'PURCHASE',
            itemId: { in: matchedItems.map((i) => i.id) },
            date: { gte: range.gte, lt: range.lt },
        },
        orderBy: { date: 'asc' },
    });

    const byMonth = new Map<string, number[]>();
    let excludedNonWeightCount = 0;

    for (const e of entries) {
        const norm = normalizeToKgPrice(e);
        if (norm.pricePerKg == null) {
            excludedNonWeightCount += 1;
            continue;
        }
        const key = monthKeyUTC(e.date);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key)!.push(norm.pricePerKg);
    }

    const sortedMonths = [...byMonth.keys()].sort();
    const months: PriceTrendMonth[] = [];
    let prevAvg: number | null = null;

    for (const month of sortedMonths) {
        const prices = byMonth.get(month)!;
        const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
        const momChangePct = prevAvg != null && prevAvg > 0 ? ((avg - prevAvg) / prevAvg) * 100 : null;
        months.push({
            month,
            count: prices.length,
            avgPricePerKg: avg,
            minPricePerKg: Math.min(...prices),
            maxPricePerKg: Math.max(...prices),
            momChangePct,
        });
        prevAvg = avg;
    }

    let biggestJump: { month: string; momChangePct: number } | null = null;
    for (const m of months) {
        if (m.momChangePct == null) continue;
        if (biggestJump == null || m.momChangePct > biggestJump.momChangePct) {
            biggestJump = { month: m.month, momChangePct: m.momChangePct };
        }
    }

    return {
        range: { from: range.fromKey, to: range.toKey },
        matchedItems: matchedItems.map((i) => ({ id: i.id, name: i.name, score: i.score })),
        months,
        biggestJump,
        excludedNonWeightCount,
    };
}
