// T-ML-027 範圍 C — CashCount.expensesJson 同步進 Entry。
//
// 背景：cash 清點（cash.hongjixuan-market-ledger.com）員工每天記的「當天現金支出
// 明細」（清潔費/洗攤/大腸/袋子…實付金額）目前完全沒有寫進 Entry 表，只留在
// CashCount.expensesJson 這個 JSON 欄位裡，記帳報表看不到。真實資料觀察
// （2026-08-09 唯讀查詢 30 筆 CashCount）item 欄位是員工自由輸入的縮寫，例如
// 「清」「清潔」「清潔費」都代表清潔費，「洗」「洗攤」代表洗攤，另外還有
// 「大腸」「昨日大腸」「袋子」「垃圾袋」「沙拉脫」「水電」等不固定的項目。
//
// 分類策略：優先用既有 classifyExpenseType()（T-ML-025 批 1 已實作、已測試過的
// fuzzy 比對，不重寫第二套），能對到 Dictionary(expense_type) 條目的一律照該
// 條目的 value 寫入；對不到的（例如「大腸」不是支出類型，是買肉的品項，但 cash
// 清點沒記數量/單位，無法安全地拆成合法的 PURCHASE 記錄）一律歸進「雜支」
// (misc) 這個既有 Dictionary 分類，並把原始文字保留在備註裡，方便日後人工複核，
// 不會靜默遺失。
//
// 與 A（fixedExpenseAutofill.ts 自動帶固定支出）的關係：C 一律用 upsertExpenseEntry
// 的 'overwrite' 模式（cash 清點的實付數字是最後真相），A 一律用 'skip-if-exists'。
// 詳細推導見 fixedExpenseAutofill.ts 檔頭註解 + T-ML-027 learning brief。

import prisma from '@/lib/prisma';
import { classifyExpenseType } from '@/lib/analytics/classifyExpense';
import type { StallCode } from '@/lib/analytics/stallInference';
import { stallCanonicalLabel, upsertExpenseEntry, type EntryWriteDb } from '@/lib/fixedExpenseAutofill';

export interface CashExpenseRowInput {
    item: string;
    note: string;
    amount: number;
}

export interface CashExpenseSyncItem {
    item: string;
    expenseType: string;
    expenseLabel: string;
    amount: number;
    confident: boolean; // true = 對到 Dictionary（exact/fuzzy），false = 落入雜支 fallback bucket
    action: 'created' | 'updated' | 'skipped';
}

export interface CashExpenseSyncResult {
    synced: CashExpenseSyncItem[];
    /** 完全無法歸類（連雜支 bucket 都找不到，例如租戶沒設「雜支」）而被跳過的原始項目 */
    unclassified: CashExpenseRowInput[];
}

const MISC_LABEL = '雜支';

/**
 * 純函式版本：給一筆 cash 清點的 (item, note) 文字 + 分類結果，算出應該寫進 Entry
 * 的 (expenseType, note, confident)。抽成純函式方便單元測試不吃分類的 DB 查詢。
 */
export function resolveCashExpenseTarget(
    row: CashExpenseRowInput,
    classification: { value: string | null; label: string | null; method: 'exact' | 'fuzzy' | 'unknown' },
    stallLabel: string,
    miscValue: string | null
): { expenseType: string; expenseLabel: string; note: string; confident: boolean } | null {
    if (classification.method !== 'unknown' && classification.value && classification.label) {
        return {
            expenseType: classification.value,
            expenseLabel: classification.label,
            note: stallLabel, // 跟 A 用同一把自然鍵（date+expenseType+note=攤位標籤），讓兩邊互相看得到彼此寫過的資料
            confident: true,
        };
    }
    if (!miscValue) return null; // 租戶沒設雜支分類，無處安放，呼叫端應記錄為 unclassified
    const itemText = row.note ? `${row.item} ${row.note}` : row.item;
    return {
        expenseType: miscValue,
        expenseLabel: MISC_LABEL,
        note: `${stallLabel}｜${itemText}`.trim(),
        confident: false,
    };
}

/**
 * 把一次 cash 清點送出的 expensesJson 全部同步進 Entry。locationId 不是屏東/潮州
 * → 回傳 null（cash 清點目前只有屏東攤位在用，但保留擴充空間，不寫死）。
 */
export async function syncCashExpensesToEntry(
    db: EntryWriteDb,
    tenantId: string,
    date: Date,
    stall: StallCode,
    userId: string | null,
    rows: CashExpenseRowInput[]
): Promise<CashExpenseSyncResult> {
    const stallLabel = stallCanonicalLabel(stall);
    const miscDict = await prisma.dictionary.findFirst({
        where: { tenantId, category: 'expense_type', label: MISC_LABEL },
        select: { value: true },
    });
    const miscValue = miscDict?.value ?? null;

    const result: CashExpenseSyncResult = { synced: [], unclassified: [] };

    for (const row of rows) {
        const itemTrimmed = row.item.trim();
        if (!itemTrimmed || !(row.amount > 0)) continue; // 空項目或金額 0 不同步（跟 cash.ts filterExpenses 的過濾邏輯一致）

        const classification = await classifyExpenseType(tenantId, itemTrimmed);
        const target = resolveCashExpenseTarget(row, classification, stallLabel, miscValue);
        if (!target) {
            result.unclassified.push(row);
            continue;
        }

        // 【T-ML-028 範圍 B】有信心分類的項目 note 本質上就是攤位標籤（見
        // resolveCashExpenseTarget），改用攤位模糊比對（matchMode='stall'）取代
        // note 完全相等 —— 讓既有的「潮州攤」「朝洲」等錯字紀錄也能被正確覆寫，
        // 不會因為 note 字串對不上而多開一筆重複紀錄。雜支 fallback 的複合備註
        // （攤位｜品項文字）不是攤位標籤，維持舊版 matchMode='note' 完全相等比對。
        const outcome = target.confident
            ? await upsertExpenseEntry(db, {
                  tenantId,
                  date,
                  expenseType: target.expenseType,
                  amount: row.amount,
                  userId,
                  mode: 'overwrite',
                  matchMode: 'stall',
                  stall,
              })
            : await upsertExpenseEntry(db, {
                  tenantId,
                  date,
                  expenseType: target.expenseType,
                  note: target.note,
                  amount: row.amount,
                  userId,
                  mode: 'overwrite',
                  matchMode: 'note',
              });

        result.synced.push({
            item: itemTrimmed,
            expenseType: target.expenseType,
            expenseLabel: target.expenseLabel,
            amount: row.amount,
            confident: target.confident,
            action: outcome.action,
        });
    }

    return result;
}
