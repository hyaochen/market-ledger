// 記帳確認流程共用的步驟：確認提示、新增品項/支出類型、確認後需要新增的判斷、最終儲存

import prisma from '../../src/lib/prisma';
import { loadDbContext } from '../matcher';
import {
    getState, setState, resetToIdle, getAllConfirmed, removeLastConfirmed, enterNewItemFlow,
} from '../state';
import { processEntries, formatSummary, formatEntry, autofillFixedExpensesForSaved } from './entry';
import { logOutcome } from '../messageLog';
import {
    CONFIRM_KEYBOARD, UNKNOWN_ITEM_KEYBOARD, buildExpenseTypeKeyboard, buildItemKeyboard, buildVendorKeyboard,
} from './keyboards';
import type { SessionData, DbContext, ParsedEntry } from '../types';
import type { Bot } from './botTypes';

// ── 傳送確認提示 ──────────────────────────────────────────────
export async function sendUncertainPrompt(bot: Bot, chatId: number, entry: ParsedEntry, idx: number, ctx: DbContext) {
    const displayText = formatEntry(entry, ctx);
    const reason = entry.uncertainReason ? `\n（${entry.uncertainReason}）` : '';
    await bot.sendMessage(
        chatId,
        `【注意】請確認：\n「${entry.rawInput}」\n→ *${displayText}*${reason}\n\n這樣記錄正確嗎？`,
        {
            parse_mode: 'Markdown',
            reply_markup: CONFIRM_KEYBOARD('yes', idx),
        },
    );
}

// ── 建立新品項 ─────────────────────────────────────────────
export async function createItem(
    tenantId: string,
    name: string,
    categoryId: string,
    defaultUnit: string,
): Promise<string> {
    const item = await prisma.item.create({
        data: { name, categoryId, defaultUnit, isActive: true, sortOrder: 0, tenantId },
    });
    return item.id;
}

// ── 新增支出項目（自動產生代碼）────────────────────────────────
export async function createExpenseType(tenantId: string, name: string): Promise<string> {
    const existing = await prisma.dictionary.findMany({
        where: { tenantId, category: 'expense_type' },
        select: { value: true, sortOrder: true },
    });
    const maxNum = existing.reduce((max, e) => {
        const m = e.value.match(/EXP(\d+)/);
        return m ? Math.max(max, parseInt(m[1])) : max;
    }, 0);
    const maxSort = existing.reduce((max, e) => Math.max(max, e.sortOrder ?? 0), 0);
    const newValue = `EXP${String(maxNum + 1).padStart(3, '0')}`;
    await prisma.dictionary.create({
        data: {
            category: 'expense_type',
            value: newValue,
            label: name,
            isActive: true,
            sortOrder: maxSort + 1,
            tenantId,
        },
    });
    return newValue;
}

// ── 處理「確認後需要新增」的邏輯 ──────────────────────────────
// 回傳 true 表示已進入新增流程（呼叫端不需要繼續）
export async function handleAcceptedEntry(
    bot: Bot, chatId: number,
    accepted: ParsedEntry,
    next: ParsedEntry | null,
    ctx: DbContext,
    session: SessionData,
): Promise<boolean> {
    // T-ML-033：這 5 個分支是「新增品項/廠商/支出類型」子流程唯一的進入點，用同一個
    // pendingLogId 標記 outcome='new_item_flow'——之後不管走哪個分支收尾都會在
    // finalizeEntries 用真正的終局 outcome 覆寫掉，這裡只是「卡在新增流程中」的中繼點。
    const logId = getState(chatId).pendingLogId;

    // EXPENSE 找不到支出類型 → 顯示所有支出類型讓使用者選
    if (accepted.type === 'EXPENSE' && !accepted.expenseType) {
        removeLastConfirmed(chatId);
        const suggestedName = accepted.itemName ?? '';
        enterNewItemFlow(chatId, { entry: accepted, suggestedName, nextUncertain: next });
        const hint = suggestedName ? `「${suggestedName}」屬於哪種支出？` : '請選擇支出類型：';
        await bot.sendMessage(chatId, hint, { reply_markup: buildExpenseTypeKeyboard(ctx.expenseTypes) });
        void logOutcome(logId, 'new_item_flow');
        return true;
    }

    // PURCHASE 有多個相似品項 → 讓使用者選擇
    if (accepted.type === 'PURCHASE' && accepted._itemCandidates?.length) {
        removeLastConfirmed(chatId);
        setState(chatId, {
            phase: 'awaiting_item_select',
            newItemPending: { entry: accepted, suggestedName: accepted.itemName ?? '', nextUncertain: next },
        });
        await bot.sendMessage(chatId,
            `「${accepted.itemName}」有以下相似品項，請選擇：`,
            { reply_markup: buildItemKeyboard(accepted._itemCandidates) },
        );
        void logOutcome(logId, 'new_item_flow');
        return true;
    }

    // PURCHASE 找不到品項 → 詢問是進貨品項還是支出費用
    if (accepted.type === 'PURCHASE' && !accepted.itemId && accepted.itemName) {
        removeLastConfirmed(chatId);
        enterNewItemFlow(chatId, { entry: accepted, suggestedName: accepted.itemName, nextUncertain: next });
        await bot.sendMessage(
            chatId,
            `找不到「${accepted.itemName}」，請選擇：\n（也可直接輸入正確名稱搜尋）`,
            { reply_markup: UNKNOWN_ITEM_KEYBOARD },
        );
        void logOutcome(logId, 'new_item_flow');
        return true;
    }

    // PURCHASE 有品項但廠商名稱找不到 → 詢問是否新增廠商
    if (accepted.type === 'PURCHASE' && accepted.itemId && accepted.vendorName && !accepted.vendorId) {
        removeLastConfirmed(chatId);
        setState(chatId, {
            phase: 'awaiting_vendor_decision',
            newItemPending: { entry: accepted, suggestedName: accepted.vendorName, nextUncertain: next },
        });
        await bot.sendMessage(chatId,
            `「${accepted.vendorName}」不在廠商清單中，要新增嗎？`,
            {
                reply_markup: { inline_keyboard: [[
                    { text: '新增廠商', callback_data: 'vendor_create' },
                    { text: '不填廠商', callback_data: 'vendor_skip' },
                ]] },
            },
        );
        void logOutcome(logId, 'new_item_flow');
        return true;
    }

    // PURCHASE 有品項但有多個廠商候選 → 顯示廠商選擇鍵盤
    if (accepted.type === 'PURCHASE' && accepted.itemId && !accepted.vendorId && accepted._vendorCandidates?.length) {
        removeLastConfirmed(chatId);
        setState(chatId, {
            phase: 'awaiting_vendor_decision',
            newItemPending: { entry: accepted, suggestedName: '', nextUncertain: next },
        });
        const historyHint = accepted._vendorCandidates!.length > 0
            ? `（${accepted._vendorCandidates!.length} 個廠商）`
            : '';
        await bot.sendMessage(chatId,
            `「${accepted.itemName}」請選擇廠商${historyHint}：`,
            { reply_markup: buildVendorKeyboard(accepted._vendorCandidates!) },
        );
        void logOutcome(logId, 'new_item_flow');
        return true;
    }

    return false;
}

// ── 靜音模式：品項已知直接記錄，不詢問廠商/確認 ────────────────
export function applyMuteMode(entries: ParsedEntry[]): ParsedEntry[] {
    return entries.map(e => {
        // PURCHASE：itemId 為 null（真的找不到品項）才保留 uncertain
        if (e.type === 'PURCHASE' && !e.itemId) return e;
        // EXPENSE：expenseType 為 null（找不到支出類型）才保留 uncertain
        if (e.type === 'EXPENSE' && !e.expenseType) return e;
        // F2/F3 fix：REVENUE locationId=null（攤位對不上/品號被誤判為地點）→ 保留 uncertain，
        // 讓使用者看到「找不到地點」提示並自行澄清，避免靜音模式下直接丟到 saveEntry 回傳 error
        if (e.type === 'REVENUE' && !e.locationId) return e;
        // 其餘情況（itemId/expenseType/locationId 已解析）→ 強制 confident，清除廠商選擇
        return {
            ...e,
            confident: true,
            uncertainReason: null,
            _vendorCandidates: undefined,
            _itemCandidates: undefined,
        };
    });
}

// T-ML-033：把儲存結果轉成 finalJson 要記錄的精簡形狀（不含 _itemCandidates 等只在
// bot 對話中暫存的欄位），runEntryParse 的 auto_saved 分支與 finalizeEntries 共用。
export function toLoggedEntry(e: ParsedEntry & { entryId?: string }) {
    return {
        type: e.type, itemId: e.itemId, itemName: e.itemName, expenseType: e.expenseType,
        locationName: e.locationName, price: e.price, quantity: e.quantity, unit: e.unit,
        entryId: e.entryId ?? null,
    };
}
export function buildFinalPayload(
    saved: (ParsedEntry & { entryId?: string })[],
    failed: { entry: ParsedEntry; error: string }[],
) {
    return {
        saved: saved.map(toLoggedEntry),
        failed: failed.map(f => ({ ...toLoggedEntry(f.entry), error: f.error })),
    };
}

// Jev 高信心採用的品項對照提示（原說法 -> 標準品項），讓使用者看得到、錯了能改
export function jevMappingNote(entries: ParsedEntry[]): string {
    const maps = entries.filter(e => e._jevMapping).map(e => `${e._jevMapping!.from} -> ${e._jevMapping!.to}`);
    return maps.length > 0 ? `

品項自動對照（AI 判斷）：${maps.join('、')}
若對照不對，請到網頁修改該筆品項。` : '';
}

// ── 儲存已確認的全部記錄並發送摘要 ──────────────────────────
export async function finalizeEntries(
    bot: Bot, chatId: number,
    session: SessionData,
    _ctx?: DbContext, // 不使用傳入的 ctx，重新載入以確保包含新建的品項/費用類型
) {
    const confirmed = getAllConfirmed(chatId);
    // T-ML-033：這是一整批（可能經過新增品項子流程）最終真正 commit 的地方，也是
    // pendingLogId 這批 log 的終點——resetToIdle 之後這個值就沒了，要先讀出來。
    const logId = getState(chatId).pendingLogId;
    resetToIdle(chatId);

    if (confirmed.length === 0) {
        void logOutcome(logId, 'rejected');
        await bot.sendMessage(chatId, '【注意】沒有任何記錄被儲存。\n（可能是機器人重新啟動導致暫存資料遺失，請重新輸入一次）');
        return;
    }

    // 重新載入最新 ctx，確保新建品項/支出類型能正確顯示名稱
    const freshCtx = await loadDbContext(session.tenantId);
    const { saved, failed } = await processEntries(confirmed, session, freshCtx);
    void logOutcome(logId, saved.length > 0 ? 'confirmed' : 'error', buildFinalPayload(saved, failed));
    const summary = formatSummary(saved, failed, freshCtx);
    await bot.sendMessage(chatId, summary);
    const fixedExpenseNotes = await autofillFixedExpensesForSaved(saved, session);
    for (const note of fixedExpenseNotes) {
        await bot.sendMessage(chatId, note);
    }
}
