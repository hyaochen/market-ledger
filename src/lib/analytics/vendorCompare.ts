// 搜尋 #2：廠商比價 — 給品項 + 日期範圍 → 同品項跨廠商的單價對照
// 注意單位：台斤 catty / 公斤 kg / 斤兩 jl 都有，換算到同一基準（元/kg）才能比。

import prisma from '@/lib/prisma';
import { resolveItemsByQuery } from './itemResolve';
import { normalizeToKgPrice } from './priceNormalize';
import { isoDateKeyUTC, resolveRange } from './dateRange';

export interface VendorCompareParams {
    tenantId: string;
    query?: string;
    itemId?: string;
    from?: string | null;
    to?: string | null;
}

export interface VendorPricePoint {
    date: string;
    pricePerKg: number;
    totalPrice: number;
    kgWeight: number;
    entryId: string;
}

export interface VendorPriceStat {
    vendorId: string;
    vendorName: string;
    count: number;
    avgPricePerKg: number;
    minPricePerKg: number;
    maxPricePerKg: number;
    latestPricePerKg: number;
    latestDate: string;
    points: VendorPricePoint[];
}

export interface VendorCompareResult {
    range: { from: string; to: string };
    matchedItems: { id: string; name: string; score: number }[];
    /** 由便宜到貴排序（依平均 元/kg） */
    vendors: VendorPriceStat[];
    /** 有進貨紀錄但單位無法換算成公斤（例如純個數單位）而被排除的筆數 */
    excludedNonWeightCount: number;
    cheapestVendorId: string | null;
    priceSpreadPct: number | null;
}

export async function compareVendorPrices(params: VendorCompareParams): Promise<VendorCompareResult> {
    const { tenantId } = params;
    const range = resolveRange(params.from, params.to, 90);

    const matchedItems = params.query || params.itemId
        ? await resolveItemsByQuery(tenantId, params.query ?? '', { itemId: params.itemId })
        : [];

    const empty: VendorCompareResult = {
        range: { from: range.fromKey, to: range.toKey },
        matchedItems: matchedItems.map((i) => ({ id: i.id, name: i.name, score: i.score })),
        vendors: [],
        excludedNonWeightCount: 0,
        cheapestVendorId: null,
        priceSpreadPct: null,
    };
    if (matchedItems.length === 0) return empty;

    const entries = await prisma.entry.findMany({
        where: {
            tenantId,
            type: 'PURCHASE',
            itemId: { in: matchedItems.map((i) => i.id) },
            vendorId: { not: null },
            date: { gte: range.gte, lt: range.lt },
        },
        include: { vendor: true },
        orderBy: { date: 'asc' },
    });

    const byVendor = new Map<string, { name: string; points: VendorPricePoint[] }>();
    let excludedNonWeightCount = 0;

    for (const e of entries) {
        const norm = normalizeToKgPrice(e);
        if (norm.pricePerKg == null || norm.kgWeight == null || !e.vendorId) {
            excludedNonWeightCount += 1;
            continue;
        }
        if (!byVendor.has(e.vendorId)) {
            byVendor.set(e.vendorId, { name: e.vendor?.name ?? '未知廠商', points: [] });
        }
        byVendor.get(e.vendorId)!.points.push({
            date: isoDateKeyUTC(e.date),
            pricePerKg: norm.pricePerKg,
            totalPrice: e.totalPrice,
            kgWeight: norm.kgWeight,
            entryId: e.id,
        });
    }

    const vendors: VendorPriceStat[] = [...byVendor.entries()].map(([vendorId, { name, points }]) => {
        const prices = points.map((p) => p.pricePerKg);
        const sortedByDate = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
        const latest = sortedByDate[sortedByDate.length - 1];
        return {
            vendorId,
            vendorName: name,
            count: points.length,
            avgPricePerKg: prices.reduce((s, p) => s + p, 0) / prices.length,
            minPricePerKg: Math.min(...prices),
            maxPricePerKg: Math.max(...prices),
            latestPricePerKg: latest.pricePerKg,
            latestDate: latest.date,
            points: sortedByDate,
        };
    });

    vendors.sort((a, b) => a.avgPricePerKg - b.avgPricePerKg);

    const cheapestVendorId = vendors[0]?.vendorId ?? null;
    let priceSpreadPct: number | null = null;
    if (vendors.length >= 2) {
        const cheapest = vendors[0].avgPricePerKg;
        const priciest = vendors[vendors.length - 1].avgPricePerKg;
        priceSpreadPct = cheapest > 0 ? ((priciest - cheapest) / cheapest) * 100 : null;
    }

    return {
        range: { from: range.fromKey, to: range.toKey },
        matchedItems: matchedItems.map((i) => ({ id: i.id, name: i.name, score: i.score })),
        vendors,
        excludedNonWeightCount,
        cheapestVendorId,
        priceSpreadPct,
    };
}
