// 資料庫比對、廠商推斷、備註推斷

import prisma from '../src/lib/prisma';
import type { ParsedEntry, DbContext } from './types';

// 載入租戶的完整 DB 上下文（品項、廠商、支出類型、單位、地點）
export async function loadDbContext(tenantId: string): Promise<DbContext> {
    const [categories, items, vendors, expenseTypes, unitDicts, locations] = await Promise.all([
        prisma.category.findMany({ where: { tenantId }, select: { id: true, name: true } }),
        prisma.item.findMany({
            where: { tenantId, isActive: true },
            select: { id: true, name: true, categoryId: true, defaultUnit: true },
            orderBy: { sortOrder: 'asc' },
        }),
        prisma.vendor.findMany({
            where: { tenantId, isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        }),
        prisma.dictionary.findMany({
            where: { tenantId, category: 'expense_type', isActive: true },
            select: { id: true, value: true, label: true },
            orderBy: { sortOrder: 'asc' },
        }),
        prisma.dictionary.findMany({
            where: { tenantId, category: 'unit', isActive: true },
            select: { value: true, label: true, meta: true },
            orderBy: { sortOrder: 'asc' },
        }),
        prisma.location.findMany({
            where: { tenantId, isActive: true },
            select: { id: true, name: true },
        }),
    ]);

    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    const units = unitDicts.map(u => {
        let toKg: number | undefined;
        let isWeight = false;
        try {
            const meta = u.meta ? JSON.parse(u.meta) : {};
            toKg = meta.toKg;
            isWeight = meta.isWeight ?? typeof meta.toKg === 'number';
        } catch { /* ignore */ }
        return { code: u.value, name: u.label, toKg, isWeight };
    });

    return {
        tenantId,
        categories: categories.map(c => ({ id: c.id, name: c.name })),
        items: items.map(i => ({
            id: i.id,
            name: i.name,
            categoryId: i.categoryId,
            defaultUnit: i.defaultUnit,
            categoryName: categoryMap.get(i.categoryId) ?? '',
        })),
        vendors,
        expenseTypes,
        units,
        locations,
    };
}

// 中文 fuzzy 比對分數（0~1）
function fuzzyScore(query: string, target: string): number {
    const q = query.trim().toLowerCase();
    const t = target.trim().toLowerCase();
    if (!q || !t) return 0;
    if (t === q) return 1.0;
    if (t.includes(q) || q.includes(t)) return 0.85;
    // 字元重疊率
    const qChars = [...new Set(q.split(''))];
    const tChars = new Set(t.split(''));
    const intersection = qChars.filter(c => tChars.has(c)).length;
    const baseScore = intersection / Math.max(qChars.length, tChars.size);
    // 短詞懲罰：2字以下容易因單一共同字誤判（如醬油↔豬油）
    const minLen = Math.min(q.length, t.length);
    return minLen <= 2 ? baseScore * 0.75 : baseScore;
}

// 驗證並補全 Ollama 解析結果
export async function enrichEntry(entry: ParsedEntry, ctx: DbContext): Promise<ParsedEntry> {
    const enriched = { ...entry };

    if (entry.type === 'REVENUE') {
        // 用 itemName（LLM 提取的地點名稱）fuzzy match location
        const queryName = entry.locationName ?? entry.itemName ?? '';
        if (queryName) {
            let bestScore = 0;
            let bestLoc: typeof ctx.locations[0] | null = null;
            for (const loc of ctx.locations) {
                const score = fuzzyScore(queryName, loc.name);
                if (score > bestScore) { bestScore = score; bestLoc = loc; }
            }
            if (bestLoc && bestScore >= 0.4) {
                enriched.locationId = bestLoc.id;
                enriched.locationName = bestLoc.name;
                if (bestScore < 0.9) {
                    enriched.confident = false;
                    enriched.uncertainReason = `「${queryName}」→「${bestLoc.name}」$${entry.price}，請確認`;
                }
                console.log(`[Matcher] location "${queryName}" → "${bestLoc.name}" (score=${bestScore.toFixed(2)})`);
            } else {
                enriched.confident = false;
                enriched.uncertainReason = `找不到地點「${queryName}」，可用地點：${ctx.locations.map(l => l.name).join('、')}`;
                console.log(`[Matcher] location "${queryName}" no match`);
            }
        }
        return enriched;
    }

    if (entry.type === 'PURCHASE') {
        // 若 itemId 為 null，用 itemName 做 fuzzy matching
        if (!enriched.itemId && entry.itemName) {
            let bestScore = 0;
            let bestItem: typeof ctx.items[0] | null = null;
            for (const item of ctx.items) {
                const score = fuzzyScore(entry.itemName, item.name);
                if (score > bestScore) { bestScore = score; bestItem = item; }
            }
            if (bestItem && bestScore >= 0.65) {
                enriched.itemId = bestItem.id;
                enriched.itemName = bestItem.name; // 標準化名稱
                if (bestScore < 1.0) {
                    enriched.confident = false;
                    enriched.uncertainReason = `「${entry.itemName}」→「${bestItem.name}」，請確認是否正確`;
                }
                console.log(`[Matcher] item "${entry.itemName}" → "${bestItem.name}" (score=${bestScore.toFixed(2)})`);
            } else {
                enriched.confident = false;
                enriched.uncertainReason = `找不到品項「${entry.itemName}」，請確認`;
                console.log(`[Matcher] item "${entry.itemName}" no match (best score=${bestScore.toFixed(2)})`);
            }
        }

        // 設定預設單位
        if (enriched.itemId && !enriched.unit) {
            const item = ctx.items.find(i => i.id === enriched.itemId);
            if (item?.defaultUnit) enriched.unit = item.defaultUnit;
        }

        // 若有 vendorName，用 fuzzy matching 找 vendorId
        if (!enriched.vendorId && entry.vendorName) {
            // 去除「廠商」前綴（即使 LLM 包含了也能處理）
            enriched.vendorName = entry.vendorName.replace(/^廠商\s*/, '').trim();
            let bestScore = 0;
            let bestVendor: typeof ctx.vendors[0] | null = null;
            for (const v of ctx.vendors) {
                const score = fuzzyScore(enriched.vendorName, v.name);
                if (score > bestScore) { bestScore = score; bestVendor = v; }
            }
            if (bestVendor && bestScore >= 0.5) {
                enriched.vendorId = bestVendor.id;
                enriched.vendorName = bestVendor.name;
                console.log(`[Matcher] vendor "${enriched.vendorName}" → "${bestVendor.name}" (score=${bestScore.toFixed(2)})`);
            } else {
                // 廠商名稱未找到 → 標記需確認（保留清理後的 vendorName 供後續新增流程使用）
                enriched.confident = false;
                const reason = `找不到廠商「${enriched.vendorName}」，可新增或略過`;
                enriched.uncertainReason = enriched.uncertainReason
                    ? `${enriched.uncertainReason}；${reason}` : reason;
                console.log(`[Matcher] vendor "${enriched.vendorName}" no match (best score=${bestScore.toFixed(2)})`);
            }
        }

        // 廠商推斷：若 itemId 已知但無廠商（未指定廠商），詢問使用者選擇
        if (enriched.itemId && !enriched.vendorId && !entry.vendorName && ctx.vendors.length > 0) {
            // 查近期記錄，統計廠商頻率
            const recentEntries = await prisma.entry.findMany({
                where: {
                    tenantId: ctx.tenantId,
                    type: 'PURCHASE',
                    itemId: enriched.itemId,
                    vendorId: { not: null },
                },
                select: { vendorId: true },
                orderBy: { date: 'desc' },
                take: 20,
            });

            const vendorFreq = new Map<string, number>();
            recentEntries.forEach(e => {
                if (e.vendorId) vendorFreq.set(e.vendorId, (vendorFreq.get(e.vendorId) ?? 0) + 1);
            });

            const historyIds = [...vendorFreq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

            // 唯一廠商且歷史筆數夠多 → 自動帶入（不打擾使用者）
            if (historyIds.length === 1 && recentEntries.length >= 3) {
                const vendor = ctx.vendors.find(v => v.id === historyIds[0]);
                if (vendor) {
                    enriched.vendorId = vendor.id;
                    enriched.vendorName = vendor.name;
                    console.log(`[Matcher] vendor auto-inferred: "${vendor.name}" (${recentEntries.length} history)`);
                }
            } else {
                // 歷史有多個廠商，或沒有歷史 → 顯示全部廠商讓使用者選
                // 排序：有歷史的廠商優先（依頻率），其餘依名稱
                const historyVendors = historyIds
                    .map(id => ctx.vendors.find(v => v.id === id))
                    .filter((v): v is { id: string; name: string } => v != null);
                const otherVendors = ctx.vendors.filter(v => !vendorFreq.has(v.id));
                enriched._vendorCandidates = [...historyVendors, ...otherVendors];
                enriched.confident = false;
                enriched.uncertainReason = `「${enriched.itemName}」請選擇廠商`;
            }
        }

        // 重複偵測（提前告知，讓使用者決定是否再記）
        if (enriched.itemId) {
            const dup = await checkDuplicate(enriched, ctx);
            if (dup.isDuplicate && dup.existing) {
                const existing = `$${dup.existing.totalPrice}${dup.existing.note ? '（' + dup.existing.note + '）' : ''}`;
                const reason = `今天已有此記錄（${existing}），確定再記一筆？`;
                enriched.confident = false;
                enriched.uncertainReason = enriched.uncertainReason
                    ? `${enriched.uncertainReason}；${reason}` : reason;
            }
        }
    } else if (entry.type === 'EXPENSE') {
        // 用 itemName（LLM 提取的支出說明）做 fuzzy matching 找支出類型
        if (!enriched.expenseType && entry.itemName) {
            let bestScore = 0;
            let bestType: typeof ctx.expenseTypes[0] | null = null;
            for (const et of ctx.expenseTypes) {
                const score = Math.max(
                    fuzzyScore(entry.itemName, et.label),
                    fuzzyScore(entry.itemName, et.value),
                );
                if (score > bestScore) { bestScore = score; bestType = et; }
            }
            if (bestType && bestScore >= 0.4) {
                enriched.expenseType = bestType.value;
                if (bestScore < 0.9) {
                    enriched.confident = false;
                    enriched.uncertainReason = `「${entry.itemName}」→「${bestType.label}」，請確認是否正確`;
                }
                console.log(`[Matcher] expense "${entry.itemName}" → "${bestType.label}" (score=${bestScore.toFixed(2)})`);
            } else {
                enriched.confident = false;
                enriched.uncertainReason = `找不到支出類型「${entry.itemName}」，請確認`;
                console.log(`[Matcher] expense "${entry.itemName}" no match (best score=${bestScore.toFixed(2)})`);
            }
        }

        if (!enriched.expenseType) {
            enriched.confident = false;
            enriched.uncertainReason = enriched.uncertainReason ?? '無法識別支出類型';
        }

        // 重複偵測（支出）
        if (enriched.expenseType) {
            const dup = await checkDuplicate(enriched, ctx);
            if (dup.isDuplicate && dup.existing) {
                const existing = `$${dup.existing.totalPrice}${dup.existing.note ? '（' + dup.existing.note + '）' : ''}`;
                const reason = `今天已有此記錄（${existing}），確定再記一筆？`;
                enriched.confident = false;
                enriched.uncertainReason = enriched.uncertainReason
                    ? `${enriched.uncertainReason}；${reason}` : reason;
            }
        }
    }

    return enriched;
}

// 重複偵測：檢查同品項/支出 + 同日期是否已有記錄
export async function checkDuplicate(entry: ParsedEntry, ctx: DbContext): Promise<{
    isDuplicate: boolean;
    existing?: { id: string; totalPrice: number; note: string | null };
}> {
    try {
        const date = new Date(entry.date);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        if (entry.type === 'PURCHASE' && entry.itemId) {
            const existing = await prisma.entry.findFirst({
                where: {
                    tenantId: ctx.tenantId,
                    type: 'PURCHASE',
                    itemId: entry.itemId,
                    date: { gte: date, lt: nextDay },
                    // 備註不同視為不重複
                    note: entry.note ?? null,
                },
                select: { id: true, totalPrice: true, note: true },
            });
            if (existing) return { isDuplicate: true, existing };
        } else if (entry.type === 'EXPENSE' && entry.expenseType) {
            const existing = await prisma.entry.findFirst({
                where: {
                    tenantId: ctx.tenantId,
                    type: 'EXPENSE',
                    expenseType: entry.expenseType,
                    date: { gte: date, lt: nextDay },
                    note: entry.note ?? null,
                },
                select: { id: true, totalPrice: true, note: true },
            });
            if (existing) return { isDuplicate: true, existing };
        }
    } catch { /* ignore */ }
    return { isDuplicate: false };
}
