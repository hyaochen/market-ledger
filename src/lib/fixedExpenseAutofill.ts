// T-ML-027 範圍 A — 營業額自動帶固定支出（清潔費 + 洗攤），三個 Revenue 寫入
// 入口（網頁 recordRevenue / bot saveEntry / cash submitCashCount）共用這支模組。
//
// 設計重點：
// 1. 規則本身（幾號星期收多少、公休不帶）在 src/lib/analytics/fixedExpenseRules.ts，
//    這支檔案不重複定義，只負責「把規則套用到某一天某個攤位，寫進 Entry 表」。
// 2. 冪等：同日同攤同 expenseType 已存在 → 不重複建立（見 applyFixedExpenses 的
//    'skip-if-exists' 模式）。
// 3. C（cash 清點 expensesJson 同步）跟 A（本模組）會在同一次 cash 送出時都想寫
//    清潔費/洗攤 → 用「實付覆蓋自動」規則：C 用 'overwrite' 模式（見
//    upsertExpenseEntry 的 mode 參數），A 用 'skip-if-exists'。兩者用同一把
//    「自然鍵」（tenantId + type + date + expenseType + note）比對已存在的 Entry，
//    不需要在 schema 加欄位標記來源 —— 不管 A 或 C 誰先寫，C 永遠會找到並覆寫同一筆，
//    A 永遠只在完全沒有這筆時才補。詳細推導見 T-ML-027 learning brief。
// 4. 寫入操作（create/update）透過 EntryWriteDb 注入，預設是包著真正 prisma 的
//    realEntryDb，單元測試改傳一個記憶體假資料庫 —— 全專案既有慣例是分析模組的
//    唯讀查詢可以直接打真實 docker-data/dev.db（見 testFixtures.ts 說明），但
//    「寫入」測試絕對不能碰正式資料废，所以這裡特別做依賴注入。

import prisma from '@/lib/prisma';
import { STALLS, inferStallFromNote, type StallCode } from '@/lib/analytics/stallInference';
import { getWeekdayUTC } from '@/lib/analytics/dateRange';
import {
    expectedCleaningFee,
    expectedWashFee,
    getFixedExpenseDictValues,
    FIXED_EXPENSE_LABELS,
} from '@/lib/analytics/fixedExpenseRules';

export type FixedExpenseLabel = typeof FIXED_EXPENSE_LABELS.cleaning | typeof FIXED_EXPENSE_LABELS.wash;

export interface FixedExpenseLine {
    expenseType: string;
    expenseLabel: FixedExpenseLabel;
    amount: number;
}

export interface FixedExpensePreviewItem extends FixedExpenseLine {
    /** 該日該攤該類型是否已經有 Entry（不管是誰寫的）。true 時預設不勾選，避免使用者誤按造成重複支出感 */
    alreadyExists: boolean;
    existingAmount: number | null;
}

export interface FixedExpensePreview {
    stall: StallCode;
    stallLabel: string;
    locationId: string;
    items: FixedExpensePreviewItem[]; // 固定 2 筆：清潔費 + 洗攤
}

/** 從 locationId 反查是屏東還是潮州；查不到（不存在 / 不是這兩個攤位）回傳 null */
export async function stallForLocation(tenantId: string, locationId: string): Promise<StallCode | null> {
    const loc = await prisma.location.findFirst({ where: { id: locationId, tenantId } });
    if (!loc) return null;
    const stall = STALLS.find((s) => s.locationName === loc.name);
    return stall ? stall.code : null;
}

export function stallCanonicalLabel(stall: StallCode): string {
    return STALLS.find((s) => s.code === stall)!.label; // '中山' | '潮州'
}

/**
 * 純函式版本：給定攤位 + 星期 + Dictionary value + 目前已有的 Entry 列表，算出
 * 「清潔費 / 洗攤」兩筆的預期金額與是否已存在。抽成純函式方便單元測試不吃 DB。
 */
export function buildFixedExpensePreview(
    stall: StallCode,
    weekdayUTC: number,
    dictValues: { cleaningValue: string; washValue: string },
    existingEntries: { expenseType: string | null; note: string | null; totalPrice: number }[]
): FixedExpensePreviewItem[] {
    function findExisting(expenseType: string): { totalPrice: number } | null {
        return (
            existingEntries.find(
                (e) => e.expenseType === expenseType && inferStallFromNote(e.note).stall === stall
            ) ?? null
        );
    }

    const cleaningExisting = findExisting(dictValues.cleaningValue);
    const washExisting = findExisting(dictValues.washValue);

    return [
        {
            expenseType: dictValues.cleaningValue,
            expenseLabel: FIXED_EXPENSE_LABELS.cleaning,
            amount: expectedCleaningFee(stall, weekdayUTC),
            alreadyExists: !!cleaningExisting,
            existingAmount: cleaningExisting?.totalPrice ?? null,
        },
        {
            expenseType: dictValues.washValue,
            expenseLabel: FIXED_EXPENSE_LABELS.wash,
            amount: expectedWashFee(stall),
            alreadyExists: !!washExisting,
            existingAmount: washExisting?.totalPrice ?? null,
        },
    ];
}

/**
 * 網頁表單 / bot 呼叫的入口：給 tenantId + 日期（UTC 午夜 Date，呼叫端已經用自己
 * 慣用的方式算好，本函式不自己 parse 字串日期，避免重蹈 host/container TZ 地雷）
 * + locationId，回傳「應該帶入什麼」的預覽。
 *
 * 回傳 null 的情況：地點不是屏東/潮州、或該租戶沒設「清潔費/洗攤」這兩個
 * Dictionary（例如 demo 租戶）—— 兩種都代表這個租戶/地點不適用固定支出功能，
 * 呼叫端應該直接不顯示這個區塊，不是報錯。
 */
export async function previewFixedExpenses(
    tenantId: string,
    date: Date,
    locationId: string
): Promise<FixedExpensePreview | null> {
    const stall = await stallForLocation(tenantId, locationId);
    if (!stall) return null;

    const dictValues = await getFixedExpenseDictValues(tenantId);
    if (!dictValues) return null;

    const weekday = getWeekdayUTC(date);
    const existing = await prisma.entry.findMany({
        where: {
            tenantId,
            type: 'EXPENSE',
            date,
            expenseType: { in: [dictValues.cleaningValue, dictValues.washValue] },
        },
        select: { expenseType: true, note: true, totalPrice: true },
    });

    return {
        stall,
        stallLabel: stallCanonicalLabel(stall),
        locationId,
        items: buildFixedExpensePreview(stall, weekday, dictValues, existing),
    };
}

// ── 寫入層（依賴注入，見檔頭說明） ──────────────────────────────────────

export interface EntryWriteDb {
    entry: {
        findFirst(args: {
            where: { tenantId: string; type: string; date: Date; expenseType: string; note: string };
        }): Promise<{ id: string; totalPrice: number } | null>;
        create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
        update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
    };
}

/** 生產環境預設實作：包一層真正的 prisma。集中在這裡做型別轉換，其餘程式碼不需要 any。 */
export const realEntryDb: EntryWriteDb = {
    entry: {
        findFirst: (args) =>
            prisma.entry.findFirst({
                where: args.where,
                select: { id: true, totalPrice: true },
            }) as unknown as Promise<{ id: string; totalPrice: number } | null>,
        create: (args) => prisma.entry.create({ data: args.data } as Parameters<typeof prisma.entry.create>[0]),
        update: (args) =>
            prisma.entry.update({
                where: args.where,
                data: args.data,
            } as Parameters<typeof prisma.entry.update>[0]),
    },
};

export type UpsertMode = 'skip-if-exists' | 'overwrite';

export interface UpsertExpenseEntryParams {
    tenantId: string;
    date: Date;
    expenseType: string;
    /** 自然鍵的一部分 —— 必須是 deterministic 字串，同一天重複呼叫要能對到同一筆 */
    note: string;
    amount: number;
    userId: string | null;
    mode: UpsertMode;
}

export interface UpsertExpenseEntryResult {
    action: 'created' | 'updated' | 'skipped';
    entryId: string | null;
}

/**
 * 核心冪等 upsert 原語：用 (tenantId, type=EXPENSE, date, expenseType, note) 當自然鍵
 * 找既有 Entry（不靠 DB unique constraint，Entry 表本來就沒有這個 constraint，也不
 * 打算加 —— 加了會擋到使用者原本就可能手動輸入同天同類型多筆的正常情境；這裡的
 *「自然鍵」只在這支模組內部用來判斷「這是不是我自己上次寫的那一筆」）。
 *
 * mode='skip-if-exists'（A 自動帶入用）：已存在就跳過，絕不覆寫 —— 保護任何人已經
 *   填過的數字（不管是手動填的還是 C 同步填的）。
 * mode='overwrite'（C cash 清點同步用）：已存在就更新金額 —— cash 清點的實付數字
 *   永遠是最後真相，這就是「C 覆蓋 A」的實作方式。不管 A 或 C 誰先寫這筆，C 一律
 *   會找到同一個自然鍵並覆寫，A 一律只在完全沒有時才補。
 */
export async function upsertExpenseEntry(
    db: EntryWriteDb,
    params: UpsertExpenseEntryParams
): Promise<UpsertExpenseEntryResult> {
    if (!(params.amount > 0)) {
        return { action: 'skipped', entryId: null };
    }

    const existing = await db.entry.findFirst({
        where: {
            tenantId: params.tenantId,
            type: 'EXPENSE',
            date: params.date,
            expenseType: params.expenseType,
            note: params.note,
        },
    });

    if (existing) {
        if (params.mode === 'skip-if-exists') {
            return { action: 'skipped', entryId: existing.id };
        }
        // overwrite：金額不同才真的打一次 update，相同就當成「已同步」不重複寫
        if (existing.totalPrice === params.amount) {
            return { action: 'skipped', entryId: existing.id };
        }
        await db.entry.update({ where: { id: existing.id }, data: { totalPrice: params.amount, updatedAt: new Date() } });
        return { action: 'updated', entryId: existing.id };
    }

    const created = await db.entry.create({
        data: {
            type: 'EXPENSE',
            date: params.date,
            expenseType: params.expenseType,
            totalPrice: params.amount,
            note: params.note,
            tenantId: params.tenantId,
            userId: params.userId ?? undefined,
            status: 'APPROVED',
        },
    });
    return { action: 'created', entryId: created.id };
}

export interface ApplyFixedExpensesResult {
    created: FixedExpenseLine[];
    updated: FixedExpenseLine[];
    skipped: FixedExpenseLine[];
}

/**
 * A 的實際寫入：把使用者確認（可能已編輯金額 / 取消勾選）過的固定支出項目寫進
 * Entry，逐筆走 upsertExpenseEntry('skip-if-exists')。items 應該是呼叫端從
 * previewFixedExpenses() 的結果篩選/編輯過的子集 —— 這支函式不重新計算金額，
 * 完全信任呼叫端傳進來的數字（這就是「可改」的落地方式：使用者改過的金額會
 * 原樣寫入，不會被規則重新覆蓋）。
 */
export async function applyFixedExpenses(
    db: EntryWriteDb,
    tenantId: string,
    date: Date,
    stall: StallCode,
    userId: string | null,
    items: FixedExpenseLine[]
): Promise<ApplyFixedExpensesResult> {
    const stallLabel = stallCanonicalLabel(stall);
    const result: ApplyFixedExpensesResult = { created: [], updated: [], skipped: [] };

    for (const item of items) {
        const outcome = await upsertExpenseEntry(db, {
            tenantId,
            date,
            expenseType: item.expenseType,
            note: stallLabel,
            amount: item.amount,
            userId,
            mode: 'skip-if-exists',
        });
        if (outcome.action === 'created') result.created.push(item);
        else if (outcome.action === 'updated') result.updated.push(item); // skip-if-exists 理論上不會發生，防禦性保留
        else result.skipped.push(item);
    }

    return result;
}
