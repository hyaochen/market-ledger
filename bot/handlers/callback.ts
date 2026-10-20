// Telegram inline keyboard 回調（callback_query）處理。
//
// 原本是 bot/index.ts 裡一支 ~480 行、十幾個 if 串起來的閉包。現在是一張分派表
// CALLBACK_ROUTES：由上到下找第一個符合 callback_data 的路由，再呼叫對應的小函式。
// 順序與拆分前的 if 串完全一致。查詢選單（q:*）在 menuCallback.ts。

import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../src/lib/prisma';
import { getSession } from '../auth';
import { loadDbContext, enrichEntry } from '../matcher';
import {
    getState, setState,
    acceptCurrent, rejectCurrent, addToConfirmed, exitNewItemFlow,
} from '../state';
import { formatEntry } from './entry';
import { saveAlias } from '../aliases';
import { logOutcome, logCallback } from '../messageLog';
import { buildExpenseTypeKeyboard, buildVendorKeyboard, buildCategoryKeyboard } from './keyboards';
import { runDateQuery, runEntryParse } from './runners';
import {
    createItem, createExpenseType, finalizeEntries, handleAcceptedEntry, sendUncertainPrompt,
} from './flow';
import { handleMenuCallback } from './menuCallback';
import type { ParsedEntry } from '../types';
import type { Bot, CbCtx } from './botTypes';

// 意圖釐清：使用者選「查詢」還是「記帳」
async function onIntentChoice(c: CbCtx): Promise<void> {
    const { bot, query, chatId, telegramId, data, session, state } = c;
    const pendingText = state.pendingClarifyText;
    // T-ML-033：回填當初 ambiguous 那一列的 outcome（維持 clarify_intent，只補
    // finalJson 記使用者實際選了哪個），再清掉 pendingLogId——後面 runDateQuery
    // 不會動這個欄位、runEntryParse 會建自己新的一筆，不清乾淨會留舊值。
    const clarifyLogId = state.pendingLogId;
    setState(chatId, { phase: 'idle', pendingClarifyText: null, pendingLogId: undefined });
    void logOutcome(clarifyLogId, 'clarify_intent', { resolvedAs: data === 'intent_query' ? 'query' : 'entry' });
    if (!pendingText) {
        await bot.sendMessage(chatId, '這則訊息已經過期了，請重新輸入一次。');
        return;
    }
    const msgId = query.message?.message_id;
    if (data === 'intent_query') {
        await runDateQuery(bot, chatId, session, pendingText, undefined, msgId, telegramId);
    } else {
        await runEntryParse(bot, chatId, session, pendingText, undefined, msgId, telegramId);
    }
    return;
}

// 廠商：新增
async function onVendorCreate(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    try {
        const vendor = await prisma.vendor.create({
            data: { name: pending.suggestedName, isActive: true, tenantId: session.tenantId },
        });
        const updatedEntry = { ...pending.entry, vendorId: vendor.id, vendorName: vendor.name };
        addToConfirmed(chatId, updatedEntry);
        await bot.sendMessage(chatId, `已新增廠商「${vendor.name}」。`);
    } catch (e) {
        // 若廠商名稱重複，嘗試查找後使用
        const existing = await prisma.vendor.findFirst({
            where: { name: pending.suggestedName, tenantId: session.tenantId },
        });
        if (existing) {
            addToConfirmed(chatId, { ...pending.entry, vendorId: existing.id, vendorName: existing.name });
            await bot.sendMessage(chatId, `廠商「${existing.name}」已存在，已使用。`);
        } else {
            addToConfirmed(chatId, pending.entry);
            await bot.sendMessage(chatId, `新增廠商失敗，將不記錄廠商：${e}`);
        }
    }
    const next = exitNewItemFlow(chatId);
    if (next) await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    else await finalizeEntries(bot, chatId, session);
    return;
}

// 廠商：選擇已有廠商
async function onVendorSelect(c: CbCtx): Promise<void> {
    const { bot, chatId, data, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    const vendorId = data.replace('vendor_select_', '');
    const vendor = ctx.vendors.find(v => v.id === vendorId);
    addToConfirmed(chatId, { ...pending.entry, vendorId, vendorName: vendor?.name ?? null });
    await bot.sendMessage(chatId, `廠商：${vendor?.name ?? vendorId}`);
    const next = exitNewItemFlow(chatId);
    if (next) await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    else await finalizeEntries(bot, chatId, session);
    return;
}

// 廠商：不記錄
async function onVendorSkip(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    // 清除 vendorName，不記錄廠商
    addToConfirmed(chatId, { ...pending.entry, vendorName: null, vendorId: null });
    const next = exitNewItemFlow(chatId);
    if (next) await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    else await finalizeEntries(bot, chatId, session);
    return;
}

// 從相似品項中選擇
async function onItemSelect(c: CbCtx): Promise<void> {
    const { bot, chatId, data, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    const itemId = data.replace('item_select_', '');
    const item = ctx.items.find(i => i.id === itemId);
    if (!item) {
        await bot.sendMessage(chatId, '找不到該品項，請重新選擇。');
        return;
    }

    // 用選定品項重新做 enrichment（主要是補廠商推斷）
    const enrich = enrichEntry;
    const selectedEntry = { ...pending.entry, itemId: item.id, itemName: item.name, _itemCandidates: undefined };
    const enriched2 = await enrich(selectedEntry, ctx);
    const savedNext = pending.nextUncertain;

    if (enriched2._vendorCandidates?.length) {
        setState(chatId, {
            phase: 'awaiting_vendor_decision',
            newItemPending: { entry: enriched2, suggestedName: '', nextUncertain: savedNext },
        });
        await bot.sendMessage(chatId,
            `「${item.name}」請選擇廠商（${enriched2._vendorCandidates.length} 個）：`,
            { reply_markup: buildVendorKeyboard(enriched2._vendorCandidates) },
        );
    } else if (enriched2.itemId && enriched2.vendorName && !enriched2.vendorId) {
        setState(chatId, {
            phase: 'awaiting_vendor_decision',
            newItemPending: { entry: enriched2, suggestedName: enriched2.vendorName, nextUncertain: savedNext },
        });
        await bot.sendMessage(chatId,
            `「${enriched2.vendorName}」不在廠商清單中，要新增嗎？`,
            { reply_markup: { inline_keyboard: [[
                { text: '新增廠商', callback_data: 'vendor_create' },
                { text: '不填廠商', callback_data: 'vendor_skip' },
            ]] } },
        );
    } else {
        addToConfirmed(chatId, enriched2);
        setState(chatId, {
            phase: savedNext ? 'awaiting_confirmation' : 'idle',
            newItemPending: null,
            currentUncertain: savedNext,
        });
        if (savedNext) await sendUncertainPrompt(bot, chatId, savedNext, 0, ctx);
        else await finalizeEntries(bot, chatId, session);
    }
    return;
}

// 新增為進貨品項 -> 顯示分類鍵盤
async function onNewPurchaseCreate(c: CbCtx): Promise<void> {
    const { bot, chatId, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    if (ctx.categories.length === 0) {
        await bot.sendMessage(chatId, '尚無品項分類，請先至後台新增分類。');
        return;
    }
    setState(chatId, {
        phase: 'awaiting_category_select',
        newItemPending: { ...pending, confirmedItemName: pending.suggestedName },
    });
    await bot.sendMessage(chatId, `新增「${pending.suggestedName}」，請選擇進貨分類：`, {
        reply_markup: buildCategoryKeyboard(ctx.categories),
    });
    return;
}

// 新增為支出費用
async function onNewExpenseCreate(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    try {
        const newValue = await createExpenseType(session.tenantId, pending.suggestedName);
        const updatedEntry: ParsedEntry = {
            ...pending.entry,
            type: 'EXPENSE',
            expenseType: newValue,
            itemId: null,
        };
        addToConfirmed(chatId, updatedEntry);
        await bot.sendMessage(chatId, `已新增「${pending.suggestedName}」為支出費用。`);
    } catch (e) {
        await bot.sendMessage(chatId, `新增失敗：${e}`);
    }
    const next = exitNewItemFlow(chatId);
    if (next) {
        await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    } else {
        await finalizeEntries(bot, chatId, session, ctx);
    }
    return;
}

// 品項分類選擇（新增 PURCHASE 品項）
async function onCategorySelect(c: CbCtx): Promise<void> {
    const { bot, chatId, data, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;

    const categoryId = data.replace('cat_select_', '');
    const itemName = pending.confirmedItemName ?? pending.suggestedName;
    const defaultUnit = pending.entry.unit ?? ctx.units[0]?.code ?? '個';
    const savedNextUncertain = pending.nextUncertain;

    try {
        const newItemId = await createItem(session.tenantId, itemName, categoryId, defaultUnit);
        const category = ctx.categories.find(c => c.id === categoryId);
        const updatedEntry: ParsedEntry = { ...pending.entry, itemId: newItemId, itemName };

        await bot.sendMessage(chatId, `已新增品項「${itemName}」（分類：${category?.name ?? categoryId}）`);

        // 新品項建立後詢問廠商（有廠商資料才問）
        if (ctx.vendors.length > 0) {
            setState(chatId, {
                phase: 'awaiting_vendor_decision',
                newItemPending: { entry: updatedEntry, suggestedName: '', nextUncertain: savedNextUncertain },
                currentUncertain: savedNextUncertain,
            });
            await bot.sendMessage(chatId,
                `「${itemName}」請選擇廠商（${ctx.vendors.length} 個）：`,
                { reply_markup: buildVendorKeyboard(ctx.vendors, true) },
            );
        } else {
            addToConfirmed(chatId, updatedEntry);
            setState(chatId, { phase: savedNextUncertain ? 'awaiting_confirmation' : 'idle', newItemPending: null, currentUncertain: savedNextUncertain });
            if (savedNextUncertain) {
                await sendUncertainPrompt(bot, chatId, savedNextUncertain, 0, ctx);
            } else {
                await finalizeEntries(bot, chatId, session, ctx);
            }
        }
    } catch (e) {
        await bot.sendMessage(chatId, `新增品項失敗：${e}`);
        const next = exitNewItemFlow(chatId);
        if (next) await sendUncertainPrompt(bot, chatId, next, 0, ctx);
        else await finalizeEntries(bot, chatId, session, ctx);
    }
    return;
}

// 廠商：提示輸入新廠商名稱（新建品項後）
async function onVendorCreatePrompt(c: CbCtx): Promise<void> {
    const { bot, chatId, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    setState(chatId, { phase: 'awaiting_new_vendor_input' });
    await bot.sendMessage(chatId, '請輸入新廠商名稱（或輸入「略過」不填廠商）：');
    return;
}

// 選擇已有支出類型 -> 顯示最終確認
async function onExpenseTypeSelect(c: CbCtx): Promise<void> {
    const { bot, chatId, data, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    const value = data.replace('expense_type_select_', '');
    const et = ctx.expenseTypes.find(e => e.value === value);
    if (!et) { await bot.sendMessage(chatId, '找不到該支出類型'); return; }

    // 更新 pending entry（含支出類型），顯示確認訊息讓使用者最終確認
    const finalEntry = { ...pending.entry, expenseType: value };
    setState(chatId, {
        phase: 'awaiting_new_expense',
        newItemPending: { ...pending, entry: finalEntry },
    });
    const display = formatEntry(finalEntry, ctx);
    await bot.sendMessage(chatId,
        `即將儲存：\n*${display}*\n\n確認儲存嗎？`,
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[
                { text: '確認儲存', callback_data: 'expense_save_confirm' },
                { text: '重選類型', callback_data: 'expense_reselect' },
                { text: '取消', callback_data: 'new_item_no' },
            ]] },
        },
    );
    return;
}

// 支出：確認儲存
async function onExpenseSaveConfirm(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    addToConfirmed(chatId, pending.entry);
    const next = exitNewItemFlow(chatId);
    if (next) await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    else await finalizeEntries(bot, chatId, session);
    return;
}

// 支出：重選類型
async function onExpenseReselect(c: CbCtx): Promise<void> {
    const { bot, chatId, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;
    const hint = pending.entry.itemName ? `「${pending.entry.itemName}」屬於哪種支出？` : '請選擇支出類型：';
    await bot.sendMessage(chatId, hint, { reply_markup: buildExpenseTypeKeyboard(ctx.expenseTypes) });
    return;
}

// 新增支出項目確認
async function onNewItemYes(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx, state } = c;
    const pending = state.newItemPending;
    if (!pending) return;

    if (pending.entry.type === 'EXPENSE') {
        try {
            const newValue = await createExpenseType(session.tenantId, pending.suggestedName);
            const updatedEntry: ParsedEntry = { ...pending.entry, expenseType: newValue };
            addToConfirmed(chatId, updatedEntry);
            await bot.sendMessage(chatId, `已新增「${pending.suggestedName}」為支出項目。`);
        } catch (e) {
            await bot.sendMessage(chatId, `新增失敗：${e}`);
        }
    }

    const next = exitNewItemFlow(chatId);
    if (next) {
        await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    } else {
        await finalizeEntries(bot, chatId, session, ctx);
    }
    return;
}

// 略過這筆，繼續
async function onNewItemNo(c: CbCtx): Promise<void> {
    const { bot, chatId, session, ctx } = c;
    // 略過這筆，繼續
    const next = exitNewItemFlow(chatId);
    if (next) {
        await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    } else {
        await finalizeEntries(bot, chatId, session, ctx);
    }
    return;
}

// 一般確認流程（confirm_yes_N / confirm_no_N）
async function onConfirmFlow(c: CbCtx): Promise<void> {
    const { bot, query, chatId, telegramId, data, session, ctx, state } = c;
// ── 一般確認流程 ────────────────────────────────────────
// T-ML-033：正常情況下 outcome 是 handleAcceptedEntry/finalizeEntries 透過
// pendingLogId 回填；只有 pendingLogId 已經遺失（例如當初 logIncoming 寫入失敗，
// 或 bot 重啟弄丟 in-memory 狀態）才會走到這裡，用 logCallback 補一筆 fallback
// log（route 固定 'callback'），記原始 callback_data + refMessageId 供人工回溯。
if ((data.startsWith('confirm_yes_') || data.startsWith('confirm_no_')) && state.pendingLogId == null) {
    void logCallback({
        chatId, telegramUserId: telegramId, tenantId: session.tenantId, text: data,
        refMessageId: query.message?.message_id ?? null,
    });
}
if (data.startsWith('confirm_yes_')) {
    // Guard: if state was lost (bot restart), inform user
    if (state.phase === 'idle' && !state.currentUncertain) {
        await bot.sendMessage(chatId, '【注意】暫存資料已過期（可能因機器人重啟），請重新輸入一次。');
        return;
    }
    const { accepted, next } = acceptCurrent(chatId);
    // 使用者確認了模糊比對 → 儲存 alias 供下次自動命中
    if (accepted?.type === 'PURCHASE' && accepted._originalSearchName && accepted.itemId && accepted.itemName) {
        saveAlias(session.tenantId, accepted._originalSearchName, accepted.itemId, accepted.itemName);
    }
    if (accepted && await handleAcceptedEntry(bot, chatId, accepted, next, ctx, session)) return;
    if (next) {
        await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    } else {
        await finalizeEntries(bot, chatId, session, ctx);
    }
} else if (data.startsWith('confirm_no_')) {
    const next = rejectCurrent(chatId);
    if (next) {
        await sendUncertainPrompt(bot, chatId, next, 0, ctx);
    } else {
        await finalizeEntries(bot, chatId, session, ctx);
    }
}
}

type CallbackRoute = { match: (data: string) => boolean; handler: (c: CbCtx) => Promise<void> };

// 順序即優先序（與拆分前的 if 串一致）
const CALLBACK_ROUTES: CallbackRoute[] = [
    { match: (d) => d.startsWith('q:'), handler: handleMenuCallback },
    { match: (d) => d === 'intent_query' || d === 'intent_entry', handler: onIntentChoice },
    { match: (d) => d === 'vendor_create', handler: onVendorCreate },
    { match: (d) => d.startsWith('vendor_select_'), handler: onVendorSelect },
    { match: (d) => d === 'vendor_skip', handler: onVendorSkip },
    { match: (d) => d.startsWith('item_select_'), handler: onItemSelect },
    { match: (d) => d === 'new_purchase_create', handler: onNewPurchaseCreate },
    { match: (d) => d === 'new_expense_create', handler: onNewExpenseCreate },
    { match: (d) => d.startsWith('cat_select_'), handler: onCategorySelect },
    { match: (d) => d === 'vendor_create_prompt', handler: onVendorCreatePrompt },
    { match: (d) => d.startsWith('expense_type_select_'), handler: onExpenseTypeSelect },
    { match: (d) => d === 'expense_save_confirm', handler: onExpenseSaveConfirm },
    { match: (d) => d === 'expense_reselect', handler: onExpenseReselect },
    { match: (d) => d === 'new_item_yes', handler: onNewItemYes },
    { match: (d) => d === 'new_item_no', handler: onNewItemNo },
    { match: (d) => d.startsWith('confirm_yes_') || d.startsWith('confirm_no_'), handler: onConfirmFlow },
];

export async function handleCallback(bot: Bot, query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const telegramId = query.from.id;
    const data = query.data ?? '';

    if (!chatId) return;
    // answerCallbackQuery 可能因 query 過期（>30秒）而失敗，不讓它中斷後續流程
    try { await bot.answerCallbackQuery(query.id); } catch { /* query too old — ignore */ }

    try {
        const session = await getSession(telegramId);
        if (!session) {
            await bot.sendMessage(chatId, '會話已過期，請重新登入。');
            return;
        }

        const ctx = await loadDbContext(session.tenantId);
        const state = getState(chatId);

        const route = CALLBACK_ROUTES.find((r) => r.match(data));
        if (route) await route.handler({ bot, query, chatId, telegramId, data, session, ctx, state });
    } catch (err) {
        console.error('[CallbackHandler Error]', err);
        try { await bot.sendMessage(chatId, '【注意】操作失敗，請重試。'); } catch { /* ignore */ }
    }
}
