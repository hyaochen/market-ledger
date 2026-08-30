// 分類 #9：支出自動分類 — 文字 → expenseType（清潔費/洗攤/薪資/租金/瓦斯…）
// Dictionary(category='expense_type') 是租戶自訂清單，value 可能是 EXP0xx 代碼也
// 可能直接是中文字串本身（例如清潔費 value='清潔費'，洗攤 value='EXP011'，兩種真實
// 資料都有，已用唯讀查詢驗證），所以比對同時看 label 跟 value。

import prisma from '@/lib/prisma';
import { fuzzyScore } from './textMatch';

export interface ExpenseTypeCandidate {
    value: string;
    label: string;
    score: number;
}

export interface ExpenseTypeSuggestion {
    value: string | null;
    label: string | null;
    confidence: number;
    method: 'exact' | 'fuzzy' | 'unknown';
    candidates: ExpenseTypeCandidate[];
}

const FUZZY_THRESHOLD = 0.5;

export async function classifyExpenseType(tenantId: string, text: string): Promise<ExpenseTypeSuggestion> {
    const trimmed = text.trim();
    const empty: ExpenseTypeSuggestion = { value: null, label: null, confidence: 0, method: 'unknown', candidates: [] };
    if (!trimmed) return empty;

    const dict = await prisma.dictionary.findMany({
        where: { tenantId, category: 'expense_type', isActive: true },
        select: { value: true, label: true },
    });
    if (dict.length === 0) return empty;

    const exact = dict.find((d) => d.label === trimmed || d.value === trimmed);
    if (exact) {
        return {
            value: exact.value,
            label: exact.label,
            confidence: 1,
            method: 'exact',
            candidates: [{ value: exact.value, label: exact.label, score: 1 }],
        };
    }

    const scored = dict
        .map((d) => ({ ...d, score: Math.max(fuzzyScore(trimmed, d.label), fuzzyScore(trimmed, d.value)) }))
        .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score >= FUZZY_THRESHOLD) {
        return {
            value: best.value,
            label: best.label,
            confidence: best.score,
            method: 'fuzzy',
            candidates: scored.slice(0, 5).map((s) => ({ value: s.value, label: s.label, score: s.score })),
        };
    }

    return { ...empty, candidates: scored.slice(0, 5).map((s) => ({ value: s.value, label: s.label, score: s.score })) };
}
