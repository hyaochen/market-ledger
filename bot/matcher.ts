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

// 從 rawInput 提取品項名（去除數字、單位、廠商、備註、日期後剩餘）
// 用途：當 LLM 輸出簡體字導致比對失敗時，改用原始輸入文字救援
const QTY_UNIT_CHARS = '臺台斤公斤kgKGg個包條份箱罐瓶桶組片顆克袋';
function extractNameFromRaw(raw: string): string {
    return raw
        .replace(/\d+[月日號]\d*[月日號]?/g, '')       // 日期：3月4號
        .replace(/\d+\/\d+/g, '')                       // M/D
        .replace(/備註.*/g, '')                          // 備註及其後
        .replace(/廠商\S+/g, '')                         // 廠商XXX
        .replace(/向\S+買/g, '')                         // 向XXX買
        .replace(new RegExp(`[\\d,.，。${QTY_UNIT_CHARS}]`, 'g'), '') // 數字+單位
        .trim();
}

// 簡體→繁體常用字對照（僅包含在食材/費用情境下明確無歧義的字）
// 目的：LLM 有時輸出簡體字，比對前先轉換，避免「头皮」≠「頭皮」
const S2T_MAP: Record<string, string> = {
    // 食材 / 動物
    '头': '頭', '猪': '豬', '鸡': '雞', '鸭': '鴨',
    '鱼': '魚', '虾': '蝦', '贝': '貝', '鱿': '魷',
    '鳗': '鰻', '鳝': '鱔', '鲈': '鱸', '鲑': '鮭',
    '脚': '腳', '连': '連', '带': '帶', '叶': '葉',
    '绿': '綠', '红': '紅', '黄': '黃', '蓝': '藍',
    // 費用 / 商業
    '费': '費', '钱': '錢', '块': '塊', '万': '萬',
    '购': '購', '货': '貨', '进': '進', '单': '單',
    '发': '發', '产': '產', '来': '來', '时': '時',
    '车': '車', '洁': '潔', '务': '務', '营': '營',
    '业': '業', '经': '經', '长': '長', '类': '類',
    '员': '員', '总': '總', '净': '淨',
};

function normalizeS2T(text: string): string {
    return text.split('').map(c => S2T_MAP[c] ?? c).join('');
}

// 中文 fuzzy 比對分數（0~1）
function fuzzyScore(query: string, target: string): number {
    const q = normalizeS2T(query.trim().toLowerCase());
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
        if (!enriched.itemId && (entry.itemName || entry.rawInput)) {
            // 清除 LLM itemName 污染並提取備註（與 EXPENSE 同樣可能發生）
            let cleanedLlmName = entry.itemName ?? '';
            if (cleanedLlmName) {
                const noteInName = cleanedLlmName.match(/備註(.+)/);
                if (noteInName && !enriched.note) {
                    enriched.note = noteInName[1].trim();
                }
                cleanedLlmName = cleanedLlmName.replace(/備註.*/g, '').replace(/廠商\S+/g, '').trim();
            }
            const llmName = cleanedLlmName;
            const rawName = entry.rawInput ? extractNameFromRaw(entry.rawInput) : '';

            // 決定主要查詢名稱：LLM 名稱優先，但同時也對 rawName 打分做比較
            const searchName = llmName || rawName;
            if (!searchName) {
                enriched.confident = false;
                enriched.uncertainReason = '無法識別品項名稱';
                return enriched;
            }

            // 收集所有分數 >= 0.5 的候選品項（llmName 和 rawName 取最高分）
            const candidates: { item: typeof ctx.items[0]; score: number }[] = [];
            for (const item of ctx.items) {
                const s1 = llmName ? fuzzyScore(llmName, item.name) : 0;
                const s2 = rawName ? fuzzyScore(rawName, item.name) : 0;
                const score = Math.max(s1, s2);
                if (score >= 0.5) candidates.push({ item, score });
            }
            candidates.sort((a, b) => b.score - a.score);

            // 若 LLM 名稱比對失敗但 rawName 不同，記錄 fallback 使用
            if (candidates.length > 0 && llmName && rawName && llmName !== rawName) {
                const llmBest = Math.max(...ctx.items.map(i => fuzzyScore(llmName, i.name)));
                const rawBest = Math.max(...ctx.items.map(i => fuzzyScore(rawName, i.name)));
                if (rawBest > llmBest + 0.1) {
                    console.log(`[Matcher] rawInput fallback: LLM="${llmName}"(${llmBest.toFixed(2)}) vs raw="${rawName}"(${rawBest.toFixed(2)})`);
                }
            }

            if (candidates.length === 0) {
                // 完全找不到相似品項 → 觸發新增流程
                enriched.confident = false;
                enriched.uncertainReason = `找不到品項「${searchName}」，請確認`;
                console.log(`[Matcher] item "${searchName}" no match`);
            } else if (candidates[0].score >= 1.0) {
                // 完全匹配 → 直接採用
                enriched.itemId = candidates[0].item.id;
                enriched.itemName = candidates[0].item.name;
                console.log(`[Matcher] item "${searchName}" exact match → "${candidates[0].item.name}"`);
            } else if (candidates.length >= 2) {
                // 多個相似品項 → 讓使用者選擇
                enriched._itemCandidates = candidates.map(c => ({ id: c.item.id, name: c.item.name }));
                enriched.confident = false;
                enriched.uncertainReason = `「${searchName}」有 ${candidates.length} 個相似品項，請選擇`;
                console.log(`[Matcher] item "${searchName}" → ${candidates.length} candidates`);
            } else {
                // 唯一候選，分數 >= 0.65 → 詢問確認；< 0.65 → 新增流程
                const best = candidates[0];
                if (best.score >= 0.65) {
                    enriched.itemId = best.item.id;
                    enriched.itemName = best.item.name;
                    enriched.confident = false;
                    enriched.uncertainReason = `「${searchName}」→「${best.item.name}」，請確認是否正確`;
                    console.log(`[Matcher] item "${searchName}" → "${best.item.name}" (score=${best.score.toFixed(2)})`);
                } else {
                    enriched.confident = false;
                    enriched.uncertainReason = `找不到品項「${searchName}」，請確認`;
                    console.log(`[Matcher] item "${searchName}" weak match only (best score=${best.score.toFixed(2)})`);
                }
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
        // Step 1：取得支出查詢名稱（清除 LLM 污染 → rawInput 備援）
        let expenseQuery: string | null = entry.itemName ?? null;

        // 清除 LLM itemName 中常見的污染：LLM 有時把「備註XXX」混進 itemName
        // 同時：若 itemName 含「備註XXX」且 note 尚未設定，則順便提取備註
        if (expenseQuery) {
            const noteInName = expenseQuery.match(/備註(.+)/);
            if (noteInName && !enriched.note) {
                enriched.note = noteInName[1].trim();
                console.log(`[Matcher] extracted note from itemName: "${enriched.note}"`);
            }
            expenseQuery = expenseQuery
                .replace(/備註.*/g, '')
                .replace(/廠商\S+/g, '')
                .trim() || null;
            if (entry.itemName && !expenseQuery) {
                console.log(`[Matcher] expense itemName "${entry.itemName}" was all artifact, cleared`);
            }
        }

        // Fallback：若 itemName 為 null 或被清空，嘗試從 rawInput 提取
        if (!expenseQuery && entry.rawInput) {
            const stripped = entry.rawInput
                .replace(/\d+[月日號]\d*[月日號]?/g, '')
                .replace(/\d+\/\d+/g, '')
                .replace(/備註.*/g, '')
                .replace(/廠商\S+/g, '')
                .replace(/[\d,，.。]/g, '')
                .replace(/[臺台斤公斤kgKG個包條份箱罐瓶桶組片顆克袋]/g, '')
                .trim();
            if (stripped.length > 0) {
                expenseQuery = stripped;
                console.log(`[Matcher] expense query from rawInput: "${stripped}"`);
            }
        }

        // Step 2：fuzzy 比對（閾值 0.6，避免「備註潮州」誤判「潮州電費」等假陽性）
        if (!enriched.expenseType && expenseQuery) {
            let bestScore = 0;
            let bestType: typeof ctx.expenseTypes[0] | null = null;
            for (const et of ctx.expenseTypes) {
                const score = Math.max(
                    fuzzyScore(expenseQuery, et.label),
                    fuzzyScore(expenseQuery, et.value),
                );
                if (score > bestScore) { bestScore = score; bestType = et; }
            }
            if (bestType && bestScore >= 0.6) {
                enriched.expenseType = bestType.value;
                if (bestScore < 0.9) {
                    enriched.confident = false;
                    enriched.uncertainReason = `「${expenseQuery}」→「${bestType.label}」，請確認是否正確`;
                }
                console.log(`[Matcher] expense "${expenseQuery}" → "${bestType.label}" (score=${bestScore.toFixed(2)})`);
            } else {
                // 分數不夠高 → 不猜測，讓使用者從清單中選擇
                enriched.confident = false;
                const hint = bestType ? `（最接近：${bestType.label} ${(bestScore * 100).toFixed(0)}%）` : '';
                enriched.uncertainReason = `「${expenseQuery}」無法確認支出類型${hint}，請選擇`;
                console.log(`[Matcher] expense "${expenseQuery}" no confident match (best=${bestScore.toFixed(2)})`);
            }
        }

        if (!enriched.expenseType) {
            enriched.confident = false;
            enriched.uncertainReason = enriched.uncertainReason ?? '無法識別支出類型，請選擇';
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
