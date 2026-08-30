// 搜尋 #1：品項關鍵字搜尋 — 給品項名（可模糊）+ 日期範圍 → 回該品項所有進貨
// （含單價、廠商、單位換算）

import prisma from '@/lib/prisma';
import { resolveItemsByQuery } from './itemResolve';
import { normalizeToKgPrice } from './priceNormalize';
import { isoDateKeyUTC, resolveRange } from './dateRange';

export interface ItemSearchParams {
    tenantId: string;
    /** 品項名稱關鍵字（模糊比對），與 itemId 擇一 */
    query?: string;
    /** 直接指定 Item.id，略過模糊比對 */
    itemId?: string;
    from?: string | null;
    to?: string | null;
}

export interface ItemSearchRow {
    entryId: string;
    date: string;
    itemId: string;
    itemName: string;
    vendorId: string | null;
    vendorName: string | null;
    inputQuantity: number | null;
    inputUnit: string | null;
    totalPrice: number;
    unitPrice: number | null;
    pricePerKg: number | null;
    note: string | null;
}

export interface ItemSearchResult {
    range: { from: string; to: string };
    matchedItems: { id: string; name: string; score: number }[];
    rows: ItemSearchRow[];
    summary: {
        count: number;
        totalQuantityKg: number;
        totalPrice: number;
        avgPricePerKg: number | null;
    };
}

export async function searchItemPurchases(params: ItemSearchParams): Promise<ItemSearchResult> {
    const { tenantId } = params;
    const range = resolveRange(params.from, params.to, 90);

    const matchedItems = params.query || params.itemId
        ? await resolveItemsByQuery(tenantId, params.query ?? '', { itemId: params.itemId })
        : [];

    if (matchedItems.length === 0) {
        return {
            range: { from: range.fromKey, to: range.toKey },
            matchedItems: [],
            rows: [],
            summary: { count: 0, totalQuantityKg: 0, totalPrice: 0, avgPricePerKg: null },
        };
    }

    const entries = await prisma.entry.findMany({
        where: {
            tenantId,
            type: 'PURCHASE',
            itemId: { in: matchedItems.map((i) => i.id) },
            date: { gte: range.gte, lt: range.lt },
        },
        include: { item: true, vendor: true },
        orderBy: { date: 'asc' },
    });

    const rows: ItemSearchRow[] = entries.map((e) => {
        const norm = normalizeToKgPrice(e);
        return {
            entryId: e.id,
            date: isoDateKeyUTC(e.date),
            itemId: e.itemId!,
            itemName: e.item?.name ?? '',
            vendorId: e.vendorId,
            vendorName: e.vendor?.name ?? null,
            inputQuantity: e.inputQuantity,
            inputUnit: e.inputUnit,
            totalPrice: e.totalPrice,
            unitPrice: e.unitPrice,
            pricePerKg: norm.pricePerKg,
            note: e.note,
        };
    });

    const withKg = rows.filter((r) => r.pricePerKg != null);
    const totalQuantityKg = withKg.reduce((sum, r) => sum + (r.totalPrice / r.pricePerKg!), 0);
    const totalPrice = rows.reduce((sum, r) => sum + r.totalPrice, 0);
    const avgPricePerKg = withKg.length > 0
        ? withKg.reduce((sum, r) => sum + r.pricePerKg!, 0) / withKg.length
        : null;

    return {
        range: { from: range.fromKey, to: range.toKey },
        matchedItems: matchedItems.map((i) => ({ id: i.id, name: i.name, score: i.score })),
        rows,
        summary: { count: rows.length, totalQuantityKg, totalPrice, avgPricePerKg },
    };
}
