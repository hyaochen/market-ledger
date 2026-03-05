// Telegram Bot 主入口（polling 模式）
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import prisma from '../src/lib/prisma';
import {
    getSession, saveSession, clearSession,
    parseLoginInput, verifyLogin,
} from './auth';
import { parseEntries } from './parser';
import { loadDbContext, enrichEntry } from './matcher';
import {
    getState, setState, setSession, resetToIdle,
    startConfirmation, acceptCurrent, rejectCurrent, getAllConfirmed,
    removeLastConfirmed, addToConfirmed, enterNewItemFlow, exitNewItemFlow,
} from './state';
import {
    processEntries, formatSummary, formatEntry,
} from './handlers/entry';
import {
    detectQueryDate, isQueryIntent, queryByDate, queryRecent,
} from './handlers/query';
import type { SessionData, DbContext, ParsedEntry } from './types';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN 未設定，請檢查 .env');
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 Bot 啟動中...');

// ── 幫助文字 ────────────────────────────────────────────────────
const HELP_TEXT = `📖 *使用說明*

*🔑 登入*：
• \`mom mom123\`  或  \`mom/mom123\`

*🛒 進貨記錄*（可多行一次輸入）：
• \`肝連2.6台斤218\`
• \`全頭皮3個360廠商海豐\`
• \`高麗菜180台斤1500\`
• \`3/3 舌頭1.7台斤171\`

*💸 支出記錄*：
• \`薪資1300備註阿秀\`
• \`清潔費220備註潮州\`

*💰 營業額*：
• \`潮州1萬\`  或  \`潮州攤位10000\`
• \`屏東2萬 潮州1.5萬\`

*📊 查詢*：
• \`今天記了什麼\`  /  \`今日\`
• \`昨天的記錄\`  /  \`3/3 記錄\`
• \`最近記錄\`

*🔧 指令*：
• /today — 今天記錄
• /logout — 登出
• /help — 說明

_不確定的品項會詢問確認，找不到時可選擇新增_`;

// ── 確認鍵盤 ────────────────────────────────────────────────────
const CONFIRM_KEYBOARD = (_action: 'yes' | 'no', idx: number) => ({
    inline_keyboard: [[
        { text: '✅ 是，正確', callback_data: `confirm_yes_${idx}` },
        { text: '❌ 不是，跳過', callback_data: `confirm_no_${idx}` },
    ]],
});

const NEW_ITEM_KEYBOARD = {
    inline_keyboard: [[
        { text: '✅ 是，新增', callback_data: 'new_item_yes' },
        { text: '❌ 否，略過', callback_data: 'new_item_no' },
    ]],
};

// 找不到品項時，詢問類型的鍵盤
const UNKNOWN_ITEM_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '🛒 新增為進貨品項', callback_data: 'new_purchase_create' },
            { text: '💸 新增為支出費用', callback_data: 'new_expense_create' },
        ],
        [{ text: '❌ 略過', callback_data: 'new_item_no' }],
    ],
};

// ── 傳送確認提示 ──────────────────────────────────────────────
async function sendUncertainPrompt(chatId: number, entry: ParsedEntry, idx: number, ctx: DbContext) {
    const displayText = formatEntry(entry, ctx);
    const reason = entry.uncertainReason ? `\n（${entry.uncertainReason}）` : '';
    await bot.sendMessage(
        chatId,
        `⚠️ 請確認：\n「${entry.rawInput}」\n→ *${displayText}*${reason}\n\n這樣記錄正確嗎？`,
        {
            parse_mode: 'Markdown',
            reply_markup: CONFIRM_KEYBOARD('yes', idx),
        },
    );
}

// ── 建立廠商選擇鍵盤 ─────────────────────────────────────────
function buildVendorKeyboard(vendors: { id: string; name: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < vendors.length; i += 2) {
        rows.push(vendors.slice(i, i + 2).map(v => ({
            text: v.name,
            callback_data: `vendor_select_${v.id}`,
        })));
    }
    rows.push([{ text: '⬜ 不填廠商', callback_data: 'vendor_skip' }]);
    return { inline_keyboard: rows };
}

// ── 建立分類鍵盤 ────────────────────────────────────────────
function buildCategoryKeyboard(categories: { id: string; name: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    // 每行最多 3 個按鈕
    for (let i = 0; i < categories.length; i += 3) {
        rows.push(categories.slice(i, i + 3).map(c => ({
            text: c.name,
            callback_data: `cat_select_${c.id}`,
        })));
    }
    rows.push([{ text: '❌ 取消', callback_data: 'new_item_no' }]);
    return { inline_keyboard: rows };
}

// ── 建立新品項 ─────────────────────────────────────────────
async function createItem(
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
async function createExpenseType(tenantId: string, name: string): Promise<string> {
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
async function handleAcceptedEntry(
    chatId: number,
    accepted: ParsedEntry,
    next: ParsedEntry | null,
    ctx: DbContext,
    session: SessionData,
): Promise<boolean> {
    // EXPENSE 找不到支出類型 → 問是否新增
    if (accepted.type === 'EXPENSE' && !accepted.expenseType && accepted.itemName) {
        removeLastConfirmed(chatId); // 先從 confirmed 移除，等建立後再加回
        enterNewItemFlow(chatId, { entry: accepted, suggestedName: accepted.itemName, nextUncertain: next });
        await bot.sendMessage(
            chatId,
            `「${accepted.itemName}」不在支出清單中。\n要新增為支出項目並記錄 $${accepted.price} 嗎？`,
            { reply_markup: NEW_ITEM_KEYBOARD },
        );
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
                    { text: '✅ 新增廠商', callback_data: 'vendor_create' },
                    { text: '⬜ 不填廠商', callback_data: 'vendor_skip' },
                ]] },
            },
        );
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
        return true;
    }

    return false;
}

// ── 主要訊息處理 ──────────────────────────────────────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    const text = (msg.text ?? '').trim();

    if (!telegramId || !text) return;

    // 指令處理
    if (text === '/start') {
        const session = await getSession(telegramId);
        if (session) {
            await bot.sendMessage(chatId,
                `👋 你好，${session.realName || session.username}！已登入（${session.tenantName}）\n\n直接輸入記帳內容或傳 /help 查看說明。`);
        } else {
            await bot.sendMessage(chatId, '👋 歡迎！請先登入。\n格式：`帳號 密碼`\n例如：`mom mom123`', { parse_mode: 'Markdown' });
            setState(chatId, { phase: 'awaiting_auth', session: null });
        }
        return;
    }

    if (text === '/help') {
        await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
        return;
    }

    if (text === '/logout') {
        await clearSession(telegramId);
        setSession(chatId, null);
        resetToIdle(chatId);
        await bot.sendMessage(chatId, '👋 已登出。');
        return;
    }

    if (text === '/today') {
        const session = await getSession(telegramId);
        if (!session) {
            await bot.sendMessage(chatId, '請先登入。格式：`帳號 密碼`', { parse_mode: 'Markdown' });
            return;
        }
        const ctx = await loadDbContext(session.tenantId);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const result = await queryByDate(today, session, ctx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 取得或驗證 session ──────────────────────────────────
    const state = getState(chatId);
    let session = await getSession(telegramId);

    // 若在 awaiting_auth 狀態 or 無 session → 嘗試登入
    if (!session) {
        const credentials = parseLoginInput(text);
        if (!credentials) {
            await bot.sendMessage(chatId, '請先登入。\n格式：`帳號 密碼`\n例如：`mom mom123`', { parse_mode: 'Markdown' });
            setState(chatId, { phase: 'awaiting_auth' });
            return;
        }

        await bot.sendMessage(chatId, '🔄 驗證中...');
        const newSession = await verifyLogin(credentials.username, credentials.password);

        if (!newSession) {
            await bot.sendMessage(chatId, '❌ 帳號或密碼錯誤，請再試一次。');
            return;
        }

        if (newSession.roleCode === 'read') {
            await bot.sendMessage(chatId, '❌ 此帳號為唯讀權限，無法新增記錄。');
            return;
        }

        await saveSession(telegramId, newSession);
        setSession(chatId, newSession);
        session = newSession;

        await bot.sendMessage(chatId,
            `✅ 登入成功，歡迎 ${newSession.realName || newSession.username}！\n帳戶：${newSession.tenantName}（${newSession.roleCode === 'admin' ? '管理員' : '一般'}）\n登入有效期 7 天。\n\n直接輸入記帳內容開始記錄。`);
        return;
    }

    // ── 等待新增品項名稱輸入（awaiting_new_purchase）──────────
    if (state.phase === 'awaiting_new_purchase' && state.newItemPending) {
        const ctx = await loadDbContext(session.tenantId);
        const pending = state.newItemPending;

        if (/^(略過|skip|跳過)$/i.test(text)) {
            const next = exitNewItemFlow(chatId);
            if (next) {
                await sendUncertainPrompt(chatId, next, 0, ctx);
            } else {
                await finalizeEntries(chatId, session, ctx);
            }
            return;
        }

        // 嘗試用新名稱重新比對
        const newName = text.trim();
        const { enrichEntry: enrich } = await import('./matcher');
        const updatedEntry: ParsedEntry = { ...pending.entry, itemName: newName, itemId: null };
        const enriched = await enrich(updatedEntry, ctx);

        if (enriched.itemId) {
            // 比對成功
            addToConfirmed(chatId, enriched);
            await bot.sendMessage(chatId, `✅ 找到「${enriched.itemName}」，已加入待儲存清單。`);
            const next = exitNewItemFlow(chatId);
            if (next) {
                await sendUncertainPrompt(chatId, next, 0, ctx);
            } else {
                await finalizeEntries(chatId, session, ctx);
            }
        } else {
            // 還是找不到 → 更新 suggestedName，顯示選擇按鈕
            setState(chatId, { newItemPending: { ...pending, suggestedName: newName } });
            await bot.sendMessage(chatId,
                `仍找不到「${newName}」，請選擇：\n（也可繼續輸入名稱搜尋）`,
                { reply_markup: UNKNOWN_ITEM_KEYBOARD });
        }
        return;
    }

    // ── 等待廠商決定（awaiting_vendor_decision，文字回應）──────
    if (state.phase === 'awaiting_vendor_decision') {
        if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
            const pending = state.newItemPending;
            if (pending) addToConfirmed(chatId, pending.entry);
            const next = exitNewItemFlow(chatId);
            if (next) {
                const ctx2 = await loadDbContext(session.tenantId);
                await sendUncertainPrompt(chatId, next, 0, ctx2);
            } else {
                await finalizeEntries(chatId, session);
            }
        } else {
            await bot.sendMessage(chatId, '請點選上方按鈕選擇廠商，或點「不記錄廠商」略過。');
        }
        return;
    }

    // ── 等待分類選擇（awaiting_category_select，文字回應）──────
    if (state.phase === 'awaiting_category_select') {
        if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
            const next = exitNewItemFlow(chatId);
            if (next) {
                const ctx2 = await loadDbContext(session.tenantId);
                await sendUncertainPrompt(chatId, next, 0, ctx2);
            } else {
                const ctx2 = await loadDbContext(session.tenantId);
                await finalizeEntries(chatId, session, ctx2);
            }
        } else {
            await bot.sendMessage(chatId, '請點選上方按鈕選擇分類，或點「❌ 取消」略過。');
        }
        return;
    }

    // ── 處於確認流程中的回覆 ──────────────────────────────
    if (state.phase === 'awaiting_confirmation' && state.currentUncertain) {
        const yes = /^(y|是|yes|對|好|確定|correct)$/i.test(text);
        const no = /^(n|否|no|不|跳過|skip)$/i.test(text);

        if (yes || no) {
            const ctx = await loadDbContext(session.tenantId);
            if (yes) {
                const { accepted, next } = acceptCurrent(chatId);
                if (accepted && await handleAcceptedEntry(chatId, accepted, next, ctx, session)) return;
                if (next) {
                    await sendUncertainPrompt(chatId, next, 0, ctx);
                } else {
                    await finalizeEntries(chatId, session, ctx);
                }
            } else {
                const next = rejectCurrent(chatId);
                if (next) {
                    await sendUncertainPrompt(chatId, next, 0, ctx);
                } else {
                    await finalizeEntries(chatId, session, ctx);
                }
            }
            return;
        }
        // 不是確認回覆 → 繼續往下處理為新輸入（重置狀態）
        resetToIdle(chatId);
    }

    // ── 查詢意圖 ──────────────────────────────────────────
    if (isQueryIntent(text)) {
        const dateResult = detectQueryDate(text);
        const ctx = await loadDbContext(session.tenantId);
        if (dateResult === 'recent') {
            const result = await queryRecent(session, ctx);
            await bot.sendMessage(chatId, result);
        } else if (dateResult) {
            const result = await queryByDate(dateResult, session, ctx);
            await bot.sendMessage(chatId, result);
        }
        return;
    }

    // ── 解析記帳輸入 ──────────────────────────────────────
    await bot.sendMessage(chatId, '🔄 解析中，請稍候...');

    const ctx = await loadDbContext(session.tenantId);
    const rawEntries = await parseEntries(text, ctx);

    if (rawEntries.length === 0) {
        await bot.sendMessage(chatId,
            '❓ 無法解析輸入內容。\n\n請確認格式，例如：\n`肝連2.6台斤218`\n\n或傳 /help 查看說明',
            { parse_mode: 'Markdown' });
        return;
    }

    // 逐筆 enrichment
    const enriched = await Promise.all(rawEntries.map(e => enrichEntry(e, ctx)));

    const { confident, uncertain } = startConfirmation(chatId, enriched);

    if (uncertain.length === 0) {
        const { saved, duplicates, failed } = await processEntries(confident, session, ctx);
        const summary = formatSummary(saved, duplicates, failed, ctx);
        resetToIdle(chatId);
        await bot.sendMessage(chatId, summary);
    } else {
        if (confident.length > 0) {
            const preview = confident.map(e => `  • ${formatEntry(e, ctx)}`).join('\n');
            await bot.sendMessage(chatId, `以下 ${confident.length} 筆確認無誤，稍後儲存：\n${preview}`);
        }
        const first = getState(chatId).currentUncertain;
        if (first) {
            await sendUncertainPrompt(chatId, first, 0, ctx);
        }
    }
});

// ── Inline Keyboard 回調 ──────────────────────────────────────
bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const telegramId = query.from.id;
    const data = query.data ?? '';

    if (!chatId) return;
    await bot.answerCallbackQuery(query.id);

    const session = await getSession(telegramId);
    if (!session) {
        await bot.sendMessage(chatId, '會話已過期，請重新登入。');
        return;
    }

    const ctx = await loadDbContext(session.tenantId);
    const state = getState(chatId);

    // ── 廠商：新增 ──────────────────────────────────────────
    if (data === 'vendor_create') {
        const pending = state.newItemPending;
        if (!pending) return;
        try {
            const vendor = await prisma.vendor.create({
                data: { name: pending.suggestedName, isActive: true, tenantId: session.tenantId },
            });
            const updatedEntry = { ...pending.entry, vendorId: vendor.id, vendorName: vendor.name };
            addToConfirmed(chatId, updatedEntry);
            await bot.sendMessage(chatId, `✅ 已新增廠商「${vendor.name}」。`);
        } catch (e) {
            // 若廠商名稱重複，嘗試查找後使用
            const existing = await prisma.vendor.findFirst({
                where: { name: pending.suggestedName, tenantId: session.tenantId },
            });
            if (existing) {
                addToConfirmed(chatId, { ...pending.entry, vendorId: existing.id, vendorName: existing.name });
                await bot.sendMessage(chatId, `✅ 廠商「${existing.name}」已存在，已使用。`);
            } else {
                addToConfirmed(chatId, pending.entry);
                await bot.sendMessage(chatId, `❌ 新增廠商失敗，將不記錄廠商：${e}`);
            }
        }
        const next = exitNewItemFlow(chatId);
        if (next) await sendUncertainPrompt(chatId, next, 0, ctx);
        else await finalizeEntries(chatId, session);
        return;
    }

    // ── 廠商：選擇已有廠商 ────────────────────────────────────
    if (data.startsWith('vendor_select_')) {
        const pending = state.newItemPending;
        if (!pending) return;
        const vendorId = data.replace('vendor_select_', '');
        const vendor = ctx.vendors.find(v => v.id === vendorId);
        addToConfirmed(chatId, { ...pending.entry, vendorId, vendorName: vendor?.name ?? null });
        await bot.sendMessage(chatId, `✅ 廠商：${vendor?.name ?? vendorId}`);
        const next = exitNewItemFlow(chatId);
        if (next) await sendUncertainPrompt(chatId, next, 0, ctx);
        else await finalizeEntries(chatId, session);
        return;
    }

    // ── 廠商：不記錄 ────────────────────────────────────────
    if (data === 'vendor_skip') {
        const pending = state.newItemPending;
        if (!pending) return;
        // 清除 vendorName，不記錄廠商
        addToConfirmed(chatId, { ...pending.entry, vendorName: null, vendorId: null });
        const next = exitNewItemFlow(chatId);
        if (next) await sendUncertainPrompt(chatId, next, 0, ctx);
        else await finalizeEntries(chatId, session);
        return;
    }

    // ── 新增為進貨品項 → 顯示分類鍵盤 ─────────────────────────
    if (data === 'new_purchase_create') {
        const pending = state.newItemPending;
        if (!pending) return;
        if (ctx.categories.length === 0) {
            await bot.sendMessage(chatId, '❌ 尚無品項分類，請先至後台新增分類。');
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

    // ── 新增為支出費用 ──────────────────────────────────────
    if (data === 'new_expense_create') {
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
            await bot.sendMessage(chatId, `✅ 已新增「${pending.suggestedName}」為支出費用。`);
        } catch (e) {
            await bot.sendMessage(chatId, `❌ 新增失敗：${e}`);
        }
        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
        return;
    }

    // ── 品項分類選擇（新增 PURCHASE 品項）──────────────────────
    if (data.startsWith('cat_select_')) {
        const pending = state.newItemPending;
        if (!pending) return;

        const categoryId = data.replace('cat_select_', '');
        const itemName = pending.confirmedItemName ?? pending.suggestedName;
        const defaultUnit = pending.entry.unit ?? ctx.units[0]?.code ?? '個';

        try {
            const newItemId = await createItem(session.tenantId, itemName, categoryId, defaultUnit);
            const category = ctx.categories.find(c => c.id === categoryId);
            const updatedEntry: ParsedEntry = { ...pending.entry, itemId: newItemId, itemName };
            addToConfirmed(chatId, updatedEntry);
            await bot.sendMessage(chatId, `✅ 已新增品項「${itemName}」（分類：${category?.name ?? categoryId}），並加入待儲存清單。`);
        } catch (e) {
            await bot.sendMessage(chatId, `❌ 新增品項失敗：${e}`);
        }

        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
        return;
    }

    // ── 新增支出項目確認 ────────────────────────────────────
    if (data === 'new_item_yes') {
        const pending = state.newItemPending;
        if (!pending) return;

        if (pending.entry.type === 'EXPENSE') {
            try {
                const newValue = await createExpenseType(session.tenantId, pending.suggestedName);
                const updatedEntry: ParsedEntry = { ...pending.entry, expenseType: newValue };
                addToConfirmed(chatId, updatedEntry);
                await bot.sendMessage(chatId, `✅ 已新增「${pending.suggestedName}」為支出項目。`);
            } catch (e) {
                await bot.sendMessage(chatId, `❌ 新增失敗：${e}`);
            }
        }

        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
        return;
    }

    if (data === 'new_item_no') {
        // 略過這筆，繼續
        const next = exitNewItemFlow(chatId);
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
        return;
    }

    // ── 一般確認流程 ────────────────────────────────────────
    if (data.startsWith('confirm_yes_')) {
        const { accepted, next } = acceptCurrent(chatId);
        if (accepted && await handleAcceptedEntry(chatId, accepted, next, ctx, session)) return;
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
    } else if (data.startsWith('confirm_no_')) {
        const next = rejectCurrent(chatId);
        if (next) {
            await sendUncertainPrompt(chatId, next, 0, ctx);
        } else {
            await finalizeEntries(chatId, session, ctx);
        }
    }
});

// ── 儲存已確認的全部記錄並發送摘要 ──────────────────────────
async function finalizeEntries(
    chatId: number,
    session: SessionData,
    _ctx?: DbContext, // 不使用傳入的 ctx，重新載入以確保包含新建的品項/費用類型
) {
    const confirmed = getAllConfirmed(chatId);
    resetToIdle(chatId);

    if (confirmed.length === 0) {
        await bot.sendMessage(chatId, '沒有任何記錄被儲存。');
        return;
    }

    // 重新載入最新 ctx，確保新建品項/支出類型能正確顯示名稱
    const freshCtx = await loadDbContext(session.tenantId);
    const { saved, duplicates, failed } = await processEntries(confirmed, session, freshCtx);
    const summary = formatSummary(saved, duplicates, failed, freshCtx);
    await bot.sendMessage(chatId, summary);
}

// ── 錯誤處理 ────────────────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('[Polling Error]', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('[Unhandled Rejection]', err);
});

console.log('✅ Bot 已啟動（polling 模式）');
