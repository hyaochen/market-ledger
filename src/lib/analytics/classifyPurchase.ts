// 分類 #8：進貨自動歸類 — 對應現有 Category（肉類/菜類/其他）。
// 用途：批 2/3 新增品項時（bot 建新品項 / 網頁快速輸入）可以先給一個分類建議，
// 而不是每次都要人工選。既有 Item 因為有 FK 已經綁定分類，這裡主要處理「這個
// 品項名稱還不在目錄裡」的情境。
//
// 三層策略（由準到不準）：
// 1. exact-catalog：名稱完全對到現有品項 → 直接用該品項的分類，confidence=1
// 2. fuzzy-catalog：模糊比對到現有品項（字元重疊率），confidence=分數
// 3. char-affinity：「歷史資料學習」—— 用該租戶既有各分類的品項名稱字元分布，
//    算新名稱跟哪個分類的字元組成最像（例如新名稱帶「肉/腸/骨/蹄」這類肉類常見字，
//    就會偏向肉類）。這層是資料驅動、不是寫死的關鍵字表，租戶自己的品項清單長怎樣
//    就學什麼，符合 spec 講的「歷史資料學習」。
// 都不到門檻 → method='unknown'，不硬猜，只給候選名單供人工判斷。

import prisma from '@/lib/prisma';
import { fuzzyRank } from './textMatch';

export interface CategoryCandidate {
    categoryId: string;
    categoryName: string;
    score: number;
}

export interface PurchaseCategorySuggestion {
    categoryId: string | null;
    categoryName: string | null;
    confidence: number;
    method: 'exact-catalog' | 'fuzzy-catalog' | 'char-affinity' | 'unknown';
    candidates: CategoryCandidate[];
}

const FUZZY_THRESHOLD = 0.6;
const AFFINITY_THRESHOLD = 0.15;
const AFFINITY_CONFIDENCE_CAP = 0.6; // char-affinity 是弱訊號，confidence 不該跟 exact 一樣高

/**
 * 「歷史資料學習」核心：給一個新名稱 + 各分類既有品項名稱清單，算新名稱跟每個分類的
 * 字元組成重疊率（分類的字元詞庫 = 該分類所有品項名稱字元的聯集，不重複計權）。
 * 抽成純函式方便單元測試（不吃 DB）。
 */
export function scoreCategoryAffinity(name: string, itemNamesByCategory: Map<string, string[]>): Map<string, number> {
    const nameChars = new Set(name.replace(/\s/g, '').split(''));
    const scores = new Map<string, number>();
    if (nameChars.size === 0) return scores;

    for (const [categoryId, itemNames] of itemNamesByCategory) {
        const corpus = new Set<string>();
        for (const itemName of itemNames) {
            for (const ch of itemName) corpus.add(ch);
        }
        if (corpus.size === 0) continue;
        let hit = 0;
        for (const ch of nameChars) if (corpus.has(ch)) hit += 1;
        scores.set(categoryId, hit / nameChars.size);
    }
    return scores;
}

export async function classifyPurchaseCategory(tenantId: string, itemName: string): Promise<PurchaseCategorySuggestion> {
    const trimmed = itemName.trim();
    const empty: PurchaseCategorySuggestion = { categoryId: null, categoryName: null, confidence: 0, method: 'unknown', candidates: [] };
    if (!trimmed) return empty;

    const [categories, items] = await Promise.all([
        prisma.category.findMany({ where: { tenantId }, select: { id: true, name: true } }),
        prisma.item.findMany({ where: { tenantId }, select: { id: true, name: true, categoryId: true } }),
    ]);
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    // 1) exact-catalog
    const exact = items.find((i) => i.name.trim() === trimmed);
    if (exact) {
        return {
            categoryId: exact.categoryId,
            categoryName: categoryNameById.get(exact.categoryId) ?? null,
            confidence: 1,
            method: 'exact-catalog',
            candidates: [{ categoryId: exact.categoryId, categoryName: categoryNameById.get(exact.categoryId) ?? '', score: 1 }],
        };
    }

    // 2) fuzzy-catalog
    const ranked = fuzzyRank(trimmed, items, (i) => i.name, FUZZY_THRESHOLD);
    if (ranked.length > 0 && ranked[0].score >= FUZZY_THRESHOLD) {
        const best = ranked[0].item;
        return {
            categoryId: best.categoryId,
            categoryName: categoryNameById.get(best.categoryId) ?? null,
            confidence: ranked[0].score,
            method: 'fuzzy-catalog',
            candidates: ranked.slice(0, 5).map((r) => ({
                categoryId: r.item.categoryId,
                categoryName: categoryNameById.get(r.item.categoryId) ?? '',
                score: r.score,
            })),
        };
    }

    // 3) char-affinity（歷史資料學習）
    const itemNamesByCategory = new Map<string, string[]>();
    for (const item of items) {
        if (!itemNamesByCategory.has(item.categoryId)) itemNamesByCategory.set(item.categoryId, []);
        itemNamesByCategory.get(item.categoryId)!.push(item.name);
    }
    const affinityScores = scoreCategoryAffinity(trimmed, itemNamesByCategory);
    const affinityCandidates: CategoryCandidate[] = [...affinityScores.entries()]
        .map(([categoryId, score]) => ({ categoryId, categoryName: categoryNameById.get(categoryId) ?? '', score }))
        .sort((a, b) => b.score - a.score);

    if (affinityCandidates.length > 0 && affinityCandidates[0].score >= AFFINITY_THRESHOLD) {
        const best = affinityCandidates[0];
        return {
            categoryId: best.categoryId,
            categoryName: best.categoryName,
            confidence: Math.min(best.score, AFFINITY_CONFIDENCE_CAP),
            method: 'char-affinity',
            candidates: affinityCandidates.slice(0, 5),
        };
    }

    return { ...empty, candidates: affinityCandidates.slice(0, 5) };
}
