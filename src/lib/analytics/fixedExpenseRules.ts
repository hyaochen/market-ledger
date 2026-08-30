// 固定支出商業規則 — 單一事實來源（T-ML-027）
//
// 背景：這兩條規則原本寫死在 anomalies.ts 的 detectMissingFixedExpenses()（案例6，
// 用來「偵測」缺漏），T-ML-027 需要同一套規則來「自動帶入」（三個 Revenue 寫入
// 入口）跟「補登」腳本。owner 明確要求規則只能有一份、不能分叉（見 task-queue.md
// T-ML-027 spec：「detectMissingFixedExpenses 已經實作過同一套規則，優先復用它的
// 規則函式，不要寫第二份」）。所以把純規則抽到這支獨立檔案，anomalies.ts 改成
// import 這裡的函式，不再自己定義。
//
// 規則來源：owner 2026-08-04 提供，用 6 月 19 筆 + 7 月 8 筆逐日驗證 27/27 全中
// （見 vault/projects/market-ledger/reports/2026-07_expense-audit.md）。
// 若 owner 之後改規則（例如漲清潔費），這兩個函式要跟著改 —— 不是資料庫設定，
// 是寫死的商業規則。

import prisma from '@/lib/prisma';
import type { StallCode } from './stallInference';

export const FIXED_EXPENSE_LABELS = {
    cleaning: '清潔費',
    wash: '洗攤',
} as const;

/** 屏東：週一/三/五=220、週二/四/六/日=110；潮州：固定 220 */
export function expectedCleaningFee(stall: StallCode, weekdayUTC: number): number {
    if (stall === 'chaozhou') return 220;
    return weekdayUTC === 1 || weekdayUTC === 3 || weekdayUTC === 5 ? 220 : 110;
}

/** 屏東：固定 300；潮州：固定 250 */
export function expectedWashFee(stall: StallCode): number {
    return stall === 'pingtung' ? 300 : 250;
}

export interface FixedExpenseDictValues {
    cleaningValue: string;
    washValue: string;
}

/**
 * 查該租戶「清潔費」「洗攤」兩個 Dictionary(category='expense_type') 條目的 value。
 * 兩種真實資料都有：value 可能直接是中文字串本身（清潔費 value='清潔費'）也可能是
 * 代碼（洗攤 value='EXP011'），已用唯讀查詢驗證過（見 anomalies.ts 原始註解）。
 * 找不到（例如 demo 租戶沒設這兩個支出類型）→ 回傳 null，呼叫端應該直接跳過整個
 * 固定支出功能，不強制建立。
 */
export async function getFixedExpenseDictValues(tenantId: string): Promise<FixedExpenseDictValues | null> {
    const [cleaningDict, washDict] = await Promise.all([
        prisma.dictionary.findFirst({ where: { tenantId, category: 'expense_type', label: FIXED_EXPENSE_LABELS.cleaning } }),
        prisma.dictionary.findFirst({ where: { tenantId, category: 'expense_type', label: FIXED_EXPENSE_LABELS.wash } }),
    ]);
    if (!cleaningDict || !washDict) return null;
    return { cleaningValue: cleaningDict.value, washValue: washDict.value };
}
