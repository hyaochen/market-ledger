// Telegram 文字訊息處理。
//
// 原本是 bot/index.ts 裡一支 ~500 行的閉包，現在拆成：
//   handleMessage      入口（驗證輸入、記 log、錯誤包裝）
//   handleCommand      /start /help /logout /menu /mute /today
//   handleLogin        沒有 session 時的登入流程（含節流、刪除含密碼的訊息）
//   PHASE_HANDLERS     對話狀態機各 phase 的文字回覆處理（以 ChatPhase 為 key 的分派表）
//   routeFreeText      一般文字：regex 查詢 detector 表 -> 意圖判斷 -> 自然語言查詢 / 記帳解析
// 行為與拆分前完全一致（同樣的回覆、同樣的狀態轉移、同樣的 detector 檢查順序）。

import type TelegramBot from 'node-telegram-bot-api';
import prisma from '../../src/lib/prisma';
import {
    getSession, saveSession, clearSession,
    parseLoginInput, verifyLogin,
} from '../auth';
import { loadDbContext, enrichEntry } from '../matcher';
import {
    getState, setState, setSession, resetToIdle,
    acceptCurrent, rejectCurrent, addToConfirmed, exitNewItemFlow,
} from '../state';
import { queryByDate, classifyQueryIntent } from './query';
import { isQueryLike } from './nlQuery';
import { logIncoming } from '../messageLog';
import { logLine, redactLoginText } from '../botLog';
import { loginThrottle, formatWait } from '../loginThrottle';
import { HELP_TEXT } from './helpText';
import { INTENT_CLARIFY_KEYBOARD, UNKNOWN_ITEM_KEYBOARD } from './keyboards';
import { MENU_ROOT_TEXT, buildRootMenu } from './menu';
import { runDateQuery, runNlQuery, runEntryParse } from './runners';
import { runQueryDetectors } from './queryDetectors';
import { finalizeEntries, handleAcceptedEntry, sendUncertainPrompt } from './flow';
import type { SessionData, ChatState, ChatPhase, ParsedEntry } from '../types';
import type { Bot } from './botTypes';

// CJK 統一表意文字（U+4E00..U+9FFF）；用碼位建構，避免原始碼裡出現跳脫被工具解成真字元
const HAS_CJK = new RegExp(`[${String.fromCharCode(0x4e00)}-${String.fromCharCode(0x9fff)}]`);

// T-ML-033：純指令類文字（無需解析），訊息進來時一律 route='command'
export const COMMAND_TEXTS = new Set(['/start', '/help', '/logout', '/menu', '/查詢', '選單', '/mute', '/today']);

/** 一則訊息的共用 context（各步驟都從這裡取 bot / 訊息 / 發話者）。 */
export type MsgCtx = {
    bot: Bot;
    msg: TelegramBot.Message;
    chatId: number;
    telegramId: number;
    text: string;
    who: string | number;
};

// ── 指令 ────────────────────────────────────────────────────────
// 回傳 true = 已處理（呼叫端直接結束）
async function handleCommand(c: MsgCtx): Promise<boolean> {
    const { bot, chatId, telegramId, text } = c;

    if (text === '/start') {
        const session = await getSession(telegramId);
        if (session) {
            await bot.sendMessage(chatId,
                `你好，${session.realName || session.username}！已登入（${session.tenantName}）\n\n直接輸入記帳內容開始記錄。\n查資料就傳 /menu（按鈕選單），或 /help 看完整說明。`);
        } else {
            await bot.sendMessage(chatId, '歡迎！請先登入。\n格式：`帳號 密碼`\n例如：`wang abcd1234`', { parse_mode: 'Markdown' });
            setState(chatId, { phase: 'awaiting_auth', session: null });
        }
        return true;
    }

    if (text === '/help') {
        await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
        return true;
    }

    if (text === '/logout') {
        await clearSession(telegramId);
        setSession(chatId, null);
        resetToIdle(chatId);
        await bot.sendMessage(chatId, '已登出。');
        return true;
    }

    // ── 查詢選單（需登入）────────────────────────────────
    if (text === '/menu' || text === '/查詢' || text === '選單') {
        const menuSession = await getSession(telegramId);
        if (!menuSession) {
            await bot.sendMessage(chatId, '請先登入。\n格式：`帳號 密碼`', { parse_mode: 'Markdown' });
            return true;
        }
        await bot.sendMessage(chatId, MENU_ROOT_TEXT, {
            parse_mode: 'Markdown',
            reply_markup: buildRootMenu(),
        });
        return true;
    }

    if (text === '/mute') {
        const current = getState(chatId).muteMode;
        setState(chatId, { muteMode: !current });
        await bot.sendMessage(chatId,
            !current
                ? '靜音模式已開啟\n品項已知時直接記錄，不再詢問廠商或二次確認。\n再傳 /mute 可關閉。'
                : '靜音模式已關閉\n恢復正常確認流程。',
        );
        return true;
    }

    if (text === '/today') {
        const session = await getSession(telegramId);
        if (!session) {
            await bot.sendMessage(chatId, '請先登入。格式：`帳號 密碼`', { parse_mode: 'Markdown' });
            return true;
        }
        const ctx = await loadDbContext(session.tenantId);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const result = await queryByDate(today, session, ctx);
        await bot.sendMessage(chatId, result);
        return true;
    }

    return false;
}

// ── 登入（沒有 session 時）──────────────────────────────────────
// 同一個 Telegram 帳號的登入嘗試排隊處理：節流是「先查、驗證完才記失敗」，
// 不排隊的話一次灌一批訊息會全部通過檢查（check-then-act race）。
const loginQueues = new Map<number, Promise<void>>();
function handleLogin(c: MsgCtx): Promise<void> {
    const prev = loginQueues.get(c.telegramId) ?? Promise.resolve();
    const run = prev.then(() => handleLoginOnce(c), () => handleLoginOnce(c));
    const tail = run.catch(() => {});
    loginQueues.set(c.telegramId, tail);
    void tail.then(() => { if (loginQueues.get(c.telegramId) === tail) loginQueues.delete(c.telegramId); });
    return run;
}

async function handleLoginOnce(c: MsgCtx): Promise<void> {
    const { bot, msg, chatId, telegramId, text } = c;

    // 含中文的兩段式訊息（例如「大腸 500」）是記帳內容不是帳密：帳號密碼都是英數。
    // 不當成登入嘗試，才不會被刪訊息、算進鎖定次數，並能在登入後自動重播。
    const parsed = parseLoginInput(text);
    const credentials = parsed && !HAS_CJK.test(parsed.username + parsed.password) ? parsed : null;
    // T-ML-033：route='auth'。絕對不存原始文字——這裡的 text 可能是「帳號 密碼」
    // 明文，只存使用者名稱（沒解析出來就存一個固定佔位字串），密碼永遠不落地。
    void logIncoming({
        chatId, messageId: msg.message_id, telegramUserId: telegramId,
        text: credentials ? `${credentials.username} [password redacted]` : '[unrecognized login format]',
        route: 'auth',
    });
    if (!credentials) {
        // 2026-08-30：session 過期時這則訊息原本被直接丟掉，使用者登入後必須重打
        // （log 分析：33 次重新登入造成 41 則訊息被迫重打）。改成暫存下來，
        // 登入成功後自動重播。指令不暫存（重播 /help 沒有意義）。
        // 只暫存含中文的訊息（記帳內容都是中文）：打錯格式的登入訊息（例如密碼裡有空格）
        // 是純 ASCII，暫存會讓密碼落進 SystemConfig。
        const worthReplaying = !text.startsWith('/') && HAS_CJK.test(text);
        if (worthReplaying) {
            setState(chatId, { phase: 'awaiting_auth', pendingReplayText: text });
            await bot.sendMessage(chatId,
                '登入已過期，請先登入。\n格式：`帳號 密碼`\n例如：`wang abcd1234`\n\n_登入後我會自動幫你送出剛才那則，不用重打。_',
                { parse_mode: 'Markdown' });
        } else {
            setState(chatId, { phase: 'awaiting_auth' });
            await bot.sendMessage(chatId, '請先登入。\n格式：`帳號 密碼`\n例如：`wang abcd1234`', { parse_mode: 'Markdown' });
        }
        return;
    }

    // 登入嘗試（無論成敗）都把含密碼的那則訊息從 Telegram 對話刪掉
    const deleteLoginMessage = async (): Promise<boolean> => {
        try { await bot.deleteMessage(chatId, msg.message_id); return true; } catch { return false; }
    };
    const throttleKeys = { telegramId, username: credentials.username };

    const lock = await loginThrottle.check(throttleKeys);
    if (lock.locked) {
        const deleted = await deleteLoginMessage();
        logLine('AUTH', chatId, `locked user=${credentials.username} wait=${formatWait(lock.retryAfterMs)}`);
        await bot.sendMessage(chatId,
            `登入嘗試太多次，請等 ${formatWait(lock.retryAfterMs)} 後再試。${deleted ? '\n（你剛才傳的訊息已刪除。）' : ''}`);
        return;
    }

    await bot.sendMessage(chatId, '驗證中...');
    const newSession = await verifyLogin(credentials.username, credentials.password);
    const deleted = await deleteLoginMessage();
    const deletedNote = deleted
        ? '\n（為了安全，你剛才傳的登入訊息已自動刪除。）'
        : '\n（請自行刪除剛才含密碼的那則訊息。）';

    if (!newSession) {
        const after = await loginThrottle.recordFailure(throttleKeys);
        logLine('AUTH', chatId, `failed user=${credentials.username}${after.locked ? ' (now locked)' : ''}`);
        if (after.locked) {
            await bot.sendMessage(chatId,
                `帳號或密碼錯誤次數太多，已暫時鎖定，請等 ${formatWait(after.retryAfterMs)} 後再試。${deletedNote}`);
        } else {
            await bot.sendMessage(chatId, `帳號或密碼錯誤，請再試一次。${deletedNote}`);
        }
        return;
    }

    // 密碼正確：清掉失敗計數（唯讀帳號也算密碼正確，不算暴力破解）
    await loginThrottle.recordSuccess(throttleKeys);

    if (newSession.roleCode === 'read') {
        await bot.sendMessage(chatId, `此帳號為唯讀權限，無法新增記錄。${deletedNote}`);
        return;
    }

    await saveSession(telegramId, newSession);
    setSession(chatId, newSession);

    const replayText = getState(chatId).pendingReplayText;
    setState(chatId, { phase: 'idle', pendingReplayText: null });

    await bot.sendMessage(chatId,
        `登入成功，歡迎 ${newSession.realName || newSession.username}！\n帳戶：${newSession.tenantName}（${newSession.roleCode === 'admin' ? '管理員' : '一般'}）\n登入有效期 90 天。${deletedNote}\n\n直接輸入記帳內容開始記錄。\n查資料就傳 /menu 叫出按鈕選單。`);

    // 把 session 過期時被擋下的那則訊息補送回自己，使用者不用重打。
    // 用 re-emit 而不是遞迴呼叫：這時 session 已存在，不會再走進上面這個分支，
    // 不會無限迴圈，而且完整重跑一次正常流程（查詢/記帳判斷都照舊）。
    if (replayText) {
        logLine('REPLAY', chatId, replayText.slice(0, 120));
        await bot.sendMessage(chatId, `幫你送出剛才那則：「${replayText}」`);
        // node-telegram-bot-api 的型別把 emit 收斂成唯讀事件集合，明確轉型後重新派送
        (bot as unknown as NodeJS.EventEmitter).emit('message', { ...msg, text: replayText });
    }
    return;
}

// ── 對話狀態機：各 phase 的文字回覆 ─────────────────────────────
// 等待支出項目確認（awaiting_new_expense，僅有按鈕互動）
async function onAwaitingNewExpense(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
        } else {
            await finalizeEntries(bot, chatId, session);
        }
    } else {
        await bot.sendMessage(chatId, '請點選上方按鈕確認是否新增支出項目，或輸入「略過」跳過。');
    }
    return true;
}

// 等待輸入新廠商名稱（awaiting_new_vendor_input）
async function onAwaitingNewVendorInput(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    if (!state.newItemPending) return false;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    const pending = state.newItemPending;
    if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
        addToConfirmed(chatId, { ...pending.entry, vendorId: null, vendorName: null });
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
        } else {
            await finalizeEntries(bot, chatId, session);
        }
        return true;
    }
    const vendorName = text.trim();
    try {
        const vendor = await prisma.vendor.create({
            data: { name: vendorName, isActive: true, tenantId: session.tenantId },
        });
        addToConfirmed(chatId, { ...pending.entry, vendorId: vendor.id, vendorName: vendor.name });
        await bot.sendMessage(chatId, `已新增廠商「${vendor.name}」。`);
    } catch {
        const existing = await prisma.vendor.findFirst({
            where: { name: vendorName, tenantId: session.tenantId },
        });
        if (existing) {
            addToConfirmed(chatId, { ...pending.entry, vendorId: existing.id, vendorName: existing.name });
            await bot.sendMessage(chatId, `廠商「${existing.name}」已存在，已使用。`);
        } else {
            addToConfirmed(chatId, { ...pending.entry, vendorId: null, vendorName: null });
            await bot.sendMessage(chatId, '新增廠商失敗，將不記錄廠商。');
        }
    }
    const next = exitNewItemFlow(chatId);
    if (next) {
        const ctx2 = await loadDbContext(session.tenantId);
        await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
    } else {
        await finalizeEntries(bot, chatId, session);
    }
    return true;
}

// 等待品項選擇（awaiting_item_select，僅有按鈕互動）
async function onAwaitingItemSelect(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
        } else {
            await finalizeEntries(bot, chatId, session);
        }
    } else {
        await bot.sendMessage(chatId, '請點選上方按鈕選擇品項，或點「略過」跳過。');
    }
    return true;
}

// 等待新增品項名稱輸入（awaiting_new_purchase）
async function onAwaitingNewPurchase(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    if (!state.newItemPending) return false;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    const ctx = await loadDbContext(session.tenantId);
    const pending = state.newItemPending;

    if (/^(略過|skip|跳過)$/i.test(text)) {
        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(bot, chatId, next, 0, ctx);
        } else {
            await finalizeEntries(bot, chatId, session, ctx);
        }
        return true;
    }

    // 嘗試用新名稱重新比對
    const newName = text.trim();
    const enrich = enrichEntry;
    const updatedEntry: ParsedEntry = { ...pending.entry, itemName: newName, itemId: null };
    const enriched = await enrich(updatedEntry, ctx);

    if (enriched.itemId) {
        // 比對成功
        addToConfirmed(chatId, enriched);
        await bot.sendMessage(chatId, `找到「${enriched.itemName}」，已加入待儲存清單。`);
        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(bot, chatId, next, 0, ctx);
        } else {
            await finalizeEntries(bot, chatId, session, ctx);
        }
    } else {
        // 還是找不到 → 更新 suggestedName，顯示選擇按鈕
        setState(chatId, { newItemPending: { ...pending, suggestedName: newName } });
        await bot.sendMessage(chatId,
            `仍找不到「${newName}」，請選擇：\n（也可繼續輸入名稱搜尋）`,
            { reply_markup: UNKNOWN_ITEM_KEYBOARD });
    }
    return true;
}

// 等待廠商決定（awaiting_vendor_decision，文字回應）
async function onAwaitingVendorDecision(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
        const pending = state.newItemPending;
        if (pending) addToConfirmed(chatId, pending.entry);
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
        } else {
            await finalizeEntries(bot, chatId, session);
        }
    } else {
        await bot.sendMessage(chatId, '請點選上方按鈕選擇廠商，或點「不記錄廠商」略過。');
    }
    return true;
}

// 等待分類選擇（awaiting_category_select，文字回應）
async function onAwaitingCategorySelect(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(bot, chatId, next, 0, ctx2);
        } else {
            const ctx2 = await loadDbContext(session.tenantId);
            await finalizeEntries(bot, chatId, session, ctx2);
        }
    } else {
        await bot.sendMessage(chatId, '請點選上方按鈕選擇分類，或點「取消」略過。');
    }
    return true;
}

// 處於確認流程中的回覆（awaiting_confirmation）
async function onAwaitingConfirmation(c: MsgCtx, session: SessionData, state: ChatState): Promise<boolean> {
    const { bot, msg, chatId, telegramId, text } = c;
    if (!state.currentUncertain) return false;
    void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId, text, route: 'state_reply', parsed: { phase: state.phase } });
    const yes = /^(y|是|yes|對|好|確定|correct)$/i.test(text);
    const no = /^(n|否|no|不|跳過|skip)$/i.test(text);

    if (yes || no) {
        const ctx = await loadDbContext(session.tenantId);
        if (yes) {
            const { accepted, next } = acceptCurrent(chatId);
            if (accepted && await handleAcceptedEntry(bot, chatId, accepted, next, ctx, session)) return true;
            if (next) {
                await sendUncertainPrompt(bot, chatId, next, 0, ctx);
            } else {
                await finalizeEntries(bot, chatId, session, ctx);
            }
        } else {
            const next = rejectCurrent(chatId);
            if (next) {
                await sendUncertainPrompt(bot, chatId, next, 0, ctx);
            } else {
                await finalizeEntries(bot, chatId, session, ctx);
            }
        }
        return true;
    }
    // 非確認詞 → 提示使用按鈕，不重置待確認記錄
    await bot.sendMessage(chatId, '【注意】請點選上方按鈕確認，或輸入「略過」放棄本批記錄。');
    return true;
}

type PhaseHandler = (c: MsgCtx, session: SessionData, state: ChatState) => Promise<boolean>;

// 每個 handler 回傳 true = 已處理；false = 不適用（例如缺 newItemPending），繼續往下走一般文字流程
const PHASE_HANDLERS: Partial<Record<ChatPhase, PhaseHandler>> = {
    awaiting_new_expense: onAwaitingNewExpense,
    awaiting_new_vendor_input: onAwaitingNewVendorInput,
    awaiting_item_select: onAwaitingItemSelect,
    awaiting_new_purchase: onAwaitingNewPurchase,
    awaiting_vendor_decision: onAwaitingVendorDecision,
    awaiting_category_select: onAwaitingCategorySelect,
    awaiting_confirmation: onAwaitingConfirmation,
};

// ── 一般文字 ────────────────────────────────────────────────────
async function routeFreeText(c: MsgCtx, session: SessionData): Promise<void> {
    const { bot, msg, chatId, telegramId, text } = c;

    // 查詢類 detector 共用同一份 ctx（原本每個分支各自 loadDbContext，重複打 DB；
    // 且 detectVendorMonthQuery 現在需要真實廠商清單才能判斷，必須先載好）
    const queryCtx = await loadDbContext(session.tenantId);

    // regex 查詢 detector（順序即優先序，見 queryDetectors.ts）
    if (await runQueryDetectors({ bot, chatId, messageId: msg.message_id, telegramId, text }, session, queryCtx)) return;

    // ── 意圖判斷：查詢 / 意圖不明 / 記帳 ───────────────────
    const intent = classifyQueryIntent(text);

    if (intent === 'query') {
        await runDateQuery(bot, chatId, session, text, queryCtx, msg.message_id, telegramId);
        return;
    }

    // ── 自然語言查詢：regex 全沒接到、但看起來是在問問題 → 交給 LLM 翻成 QuerySpec ──
    if (isQueryLike(text)) {
        await runNlQuery(bot, chatId, session, text, queryCtx, msg.message_id, telegramId);
        return;
    }

    // 有日期但看不出是查詢還是記帳 → 回頭問，絕不擅自走記帳路徑。
    // （2026-08-30：靜默降級曾讓 LLM 對查詢句「提取」出一筆不存在的營收）
    if (intent === 'ambiguous') {
        logLine('CLARIFY', chatId, text.slice(0, 120));
        // T-ML-033：route='other'（規則判不出查詢或記帳）、outcome='clarify_intent'。
        // logId 存進 pendingLogId，等使用者點了 intent_query/intent_entry callback
        // 後回填「使用者實際選了哪個」，供之後評估 Jev 意圖閘門用。
        const clarifyLogId = await logIncoming({
            chatId, messageId: msg.message_id, telegramUserId: telegramId, tenantId: session.tenantId,
            text, route: 'other', outcome: 'clarify_intent',
        });
        setState(chatId, { phase: 'awaiting_intent_clarify', pendingClarifyText: text, pendingLogId: clarifyLogId ?? undefined });
        await bot.sendMessage(chatId,
            `「${text}」我不確定你是要查詢還是要記帳，請選一個：`,
            { reply_markup: INTENT_CLARIFY_KEYBOARD });
        return;
    }

    await runEntryParse(bot, chatId, session, text, queryCtx, msg.message_id, telegramId);
}

// ── 入口 ────────────────────────────────────────────────────────
export async function handleMessage(bot: Bot, msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    const text = (msg.text ?? '').trim();

    if (!telegramId || !text) return;

    // 安全：還不知道有沒有 session 之前，只有已知的純指令文字能原文落地。
    // 其他文字可能是「帳號 密碼」明文，等 session 檢查之後再決定怎麼記（見下方）。
    const who = msg.from?.username ?? telegramId;
    if (COMMAND_TEXTS.has(text)) {
        logLine('IN', chatId, `[${who}] ${text.slice(0, 120)}`);
    }

    // T-ML-033：指令類文字一律 route='command'（fire-and-forget，不影響後續分派）
    if (COMMAND_TEXTS.has(text)) {
        void logIncoming({ chatId, messageId: msg.message_id, telegramUserId: telegramId, text, route: 'command' });
    }

    const c: MsgCtx = { bot, msg, chatId, telegramId, text, who };

    try {
        // 指令處理
        if (await handleCommand(c)) return;

        // ── 取得或驗證 session ──
        const state = getState(chatId);
        const session = await getSession(telegramId);

        // 有 session 才能原文記 log；沒 session 的文字走登入路徑，永遠只記遮蔽後的版本
        if (!COMMAND_TEXTS.has(text)) {
            logLine('IN', chatId, `[${who}] ${session ? text.slice(0, 120) : redactLoginText(text)}`);
        }

        // 若在 awaiting_auth 狀態 or 無 session -> 嘗試登入
        if (!session) {
            await handleLogin(c);
            return;
        }

        // ── 等待意圖釐清中又收到新訊息 -> 放掉舊的，照新訊息重新判斷（避免卡死）──
        if (state.phase === 'awaiting_intent_clarify') {
            setState(chatId, { phase: 'idle', pendingClarifyText: null });
        }

        // ── 對話狀態機中的文字回覆 ──
        const phaseHandler = PHASE_HANDLERS[state.phase];
        if (phaseHandler && await phaseHandler(c, session, state)) return;

        await routeFreeText(c, session);
    } catch (err) {
        console.error('[MessageHandler Error]', err);
        try { await bot.sendMessage(chatId, '【注意】處理時發生錯誤，請重新輸入。'); } catch { /* ignore */ }
    }
}
