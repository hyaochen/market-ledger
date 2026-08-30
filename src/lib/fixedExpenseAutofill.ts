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
//    「自然鍵」比對已存在的 Entry，不需要在 schema 加欄位標記來源 —— 不管 A 或 C
//    誰先寫，C 永遠會找到並覆寫同一筆，A 永遠只在完全沒有這筆時才補。詳細推導見
//    T-ML-027 learning brief。
// 4. 寫入操作（create/update）透過 EntryWriteDb 注入，預設是包著真正 prisma 的
//    realEntryDb，單元測試改傳一個記憶體假資料庫 —— 全專案既有慣例是分析模組的
//    唯讀查詢可以直接打真實 docker-data/dev.db（見 testFixtures.ts 說明），但
//    「寫入」測試絕對不能碰正式資料废，所以這裡特別做依賴注入。
// 5. 【T-ML-028 範圍 B 新增】「自然鍵」原本用 note 完全相等字串比對，會讓
//    「潮州攤」「朝洲」「屏東攤」等 17 筆歷史 typo 變體被當成跟乾淨寫法（中山/
//    潮州）不同的另一筆 —— C 覆蓋 A 時若既有紀錄剛好是 typo 版本，找不到就會
//    多開一筆重複紀錄。改成「攤位模式」（matchMode='stall'）：查詢時只用
//    (tenantId, type, date, expenseType) 撈候選，用既有 inferStallFromNote()
//    判斷每個候選屬於哪個攤位（涵蓋乾淨寫法 + 已知錯字），命中同一攤位就視為
//    同一筆。寫入的 note 一律覆寫成 stallCanonicalLabel() 的乾淨標籤（新建時），
//    但既有 Entry 的 note 文字絕對不被 update 動到 —— 正規化只作用在「怎麼找到
//    它」，不作用在「它長什麼樣子」。note=null 一律被 inferStallFromNote 判成
//    'unknown'，天生不會匹配任何具體攤位。cashExpenseSync.ts 雜支 fallback 的
//    複合備註（例如「中山｜大腸」）不是攤位標籤，繼續走舊版 matchMode='note'
//    完全相等比對。

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

/**
 * 【T-ML-028 範圍 B】從候選 Entry 清單中找出屬於指定攤位的那一筆。用既有
 * inferStallFromNote() 判斷每個候選的 note 對應到哪個攤位（涵蓋乾淨寫法 + 已知
 * 錯字變體，例如「潮州攤」「朝洲」「屏東攤」），而不是要求 note 完全等於乾淨
 * 標籤字串。note 為空/null 一律被 inferStallFromNote 判成 'unknown'，天生不會
 * 匹配任何具體攤位（stall 參數必為 'pingtung' | 'chaozhou'，不可能等於
 * 'unknown'），不會被誤判成任一攤位。多筆候選同時命中同一攤位時（理論上不該
 * 發生，業務規則是「同日同攤同類型只有一筆」）取信心最高者，信心相同則取陣列
 * 中第一筆。
 */
function pickCandidateForStall<T extends { note: string | null }>(candidates: T[], stall: StallCode): T | null {
    let best: { row: T; confidence: number } | null = null;
    for (const row of candidates) {
        const inferred = inferStallFromNote(row.note);
        if (inferred.stall !== stall) continue;
        if (!best || inferred.confidence > best.confidence) {
            best = { row, confidence: inferred.confidence };
        }
    }
    return best?.row ?? null;
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
        return pickCandidateForStall(
            existingEntries.filter((e) => e.expenseType === expenseType),
            stall
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
        /** 【T-ML-028 範圍 B】攤位模式用：不帶 note 條件，撈同日同 expenseType 的
         *  全部候選，交給呼叫端用 inferStallFromNote() 逐筆判斷攤位歸屬。 */
        findCandidates(args: {
            where: { tenantId: string; type: string; date: Date; expenseType: string };
        }): Promise<{ id: string; totalPrice: number; note: string | null }[]>;
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
        findCandidates: (args) =>
            prisma.entry.findMany({
                where: args.where,
                select: { id: true, totalPrice: true, note: true },
                orderBy: { createdAt: 'asc' },
            }) as unknown as Promise<{ id: string; totalPrice: number; note: string | null }[]>,
        create: (args) => prisma.entry.create({ data: args.data } as Parameters<typeof prisma.entry.create>[0]),
        update: (args) =>
            prisma.entry.update({
                where: args.where,
                data: args.data,
            } as Parameters<typeof prisma.entry.update>[0]),
    },
};

export type UpsertMode = 'skip-if-exists' | 'overwrite';

interface UpsertExpenseEntryBaseParams {
    tenantId: string;
    date: Date;
    expenseType: string;
    amount: number;
    userId: string | null;
    mode: UpsertMode;
}

export type UpsertExpenseEntryParams =
    | (UpsertExpenseEntryBaseParams & {
          /** 【T-ML-028】攤位模式：note 本質上是「哪個攤位」的標籤（清潔費/洗攤這類
           *  由本模組或 C 有信心分類寫入的項目）。用 inferStallFromNote 模糊比對既有
           *  候選（涵蓋已知錯字變體），寫入時 note 一律覆寫成 stallCanonicalLabel(stall)
           *  的乾淨標籤。 */
          matchMode: 'stall';
          stall: StallCode;
      })
    | (UpsertExpenseEntryBaseParams & {
          /** 舊版精確比對：note 是自由文字（例如 cashExpenseSync 雜支 fallback 的
           *  「攤位｜品項文字」複合備註），不套用攤位推斷，比對規則維持「完全相等」。 */
          matchMode: 'note';
          note: string;
      });

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
 *
 * matchMode='stall'（T-ML-028）：用 inferStallFromNote 模糊比對候選 note，取代
 *   note 完全相等 —— 讓「潮州攤」「朝洲」「屏東攤」等歷史錯字變體也能被 C 找到
 *   並正確覆寫，而不是被誤判成「不存在」而多開一筆重複紀錄。找到既有紀錄時
 *   （不論是 update 還是 skip 分支）絕對不改寫它的 note 文字 —— 正規化只作用在
 *   「怎麼找到它」；只有「新建」時才會寫入乾淨標籤。
 * matchMode='note'：維持舊版完全相等比對，給 note 是自由文字（非攤位標籤）的
 *   情境用。
 */
export async function upsertExpenseEntry(
    db: EntryWriteDb,
    params: UpsertExpenseEntryParams
): Promise<UpsertExpenseEntryResult> {
    if (!(params.amount > 0)) {
        return { action: 'skipped', entryId: null };
    }

    let existing: { id: string; totalPrice: number } | null;
    let writeNote: string;

    if (params.matchMode === 'stall') {
        const candidates = await db.entry.findCandidates({
            where: {
                tenantId: params.tenantId,
                type: 'EXPENSE',
                date: params.date,
                expenseType: params.expenseType,
            },
        });
        existing = pickCandidateForStall(candidates, params.stall);
        writeNote = stallCanonicalLabel(params.stall);
    } else {
        existing = await db.entry.findFirst({
            where: {
                tenantId: params.tenantId,
                type: 'EXPENSE',
                date: params.date,
                expenseType: params.expenseType,
                note: params.note,
            },
        });
        writeNote = params.note;
    }

    if (existing) {
        if (params.mode === 'skip-if-exists') {
            return { action: 'skipped', entryId: existing.id };
        }
        // overwrite：金額不同才真的打一次 update，相同就當成「已同步」不重複寫
        if (existing.totalPrice === params.amount) {
            return { action: 'skipped', entryId: existing.id };
        }
        // 🔴 只更新金額，note 欄位絕對不動 —— 既有 Entry 的原始寫法（就算是錯字）
        // 是 owner 的原始輸入憑證，不因為正規化比對邏輯而被改寫。
        await db.entry.update({ where: { id: existing.id }, data: { totalPrice: params.amount, updatedAt: new Date() } });
        return { action: 'updated', entryId: existing.id };
    }

    const created = await db.entry.create({
        data: {
            type: 'EXPENSE',
            date: params.date,
            expenseType: params.expenseType,
            totalPrice: params.amount,
            note: writeNote,
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
    const result: ApplyFixedExpensesResult = { created: [], updated: [], skipped: [] };

    for (const item of items) {
        const outcome = await upsertExpenseEntry(db, {
            tenantId,
            date,
            expenseType: item.expenseType,
            amount: item.amount,
            userId,
            mode: 'skip-if-exists',
            matchMode: 'stall',
            stall,
        });
        if (outcome.action === 'created') result.created.push(item);
        else if (outcome.action === 'updated') result.updated.push(item); // skip-if-exists 理論上不會發生，防禦性保留
        else result.skipped.push(item);
    }

    return result;
}
