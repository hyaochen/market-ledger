// 品項名稱解析 — #1/#2/#4 共用：使用者輸入的品項關鍵字（可能模糊/打錯字）
// 要先解析成實際 Item.id 清單，才能查 Entry。

import prisma from '@/lib/prisma';
import { fuzzyRank } from './textMatch';

export interface ResolvedItem {
    id: string;
    name: string;
    categoryId: string;
    defaultUnit: string;
    score: number;
}

const FUZZY_THRESHOLD = 0.5;

/**
 * 解析品項查詢字串成候選 Item 清單（依 tenantId 隔離）。
 * - itemId 直接命中：score=1，忽略 query 模糊比對
 * - 否則對 tenant 內所有品項做 fuzzy 比對，回傳分數 >= threshold 的候選（由高到低）
 */
export async function resolveItemsByQuery(
    tenantId: string,
    query: string,
    opts: { itemId?: string; includeInactive?: boolean; limit?: number } = {}
): Promise<ResolvedItem[]> {
    if (opts.itemId) {
        const item = await prisma.item.findFirst({
            where: { id: opts.itemId, tenantId },
        });
        if (!item) return [];
        return [{ id: item.id, name: item.name, categoryId: item.categoryId, defaultUnit: item.defaultUnit, score: 1 }];
    }

    const trimmed = query.trim();
    if (!trimmed) return [];

    const items = await prisma.item.findMany({
        where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) },
        select: { id: true, name: true, categoryId: true, defaultUnit: true },
    });

    const ranked = fuzzyRank(trimmed, items, (i) => i.name, FUZZY_THRESHOLD);
    const limited = opts.limit ? ranked.slice(0, opts.limit) : ranked;
    return limited.map((r) => ({ ...r.item, score: r.score }));
}
