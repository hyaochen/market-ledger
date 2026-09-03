// Telegram Bot 主入口（polling 模式）
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import prisma from '../src/lib/prisma';
import {
    getSession, saveSession, clearSession,
    parseLoginInput, verifyLogin,
} from './auth';
import { parseEntries, newParseDiagnostics } from './parser';
import { loadDbContext, enrichEntry } from './matcher';
import {
    preloadStates,
    getState, setState, setSession, resetToIdle,
    startConfirmation, acceptCurrent, rejectCurrent, getAllConfirmed,
    removeLastConfirmed, addToConfirmed, enterNewItemFlow, exitNewItemFlow,
} from './state';
import { runStartupBridgeHealthCheck } from './bridgeHealth';
import { startHeartbeat } from './heartbeat';
import {
    processEntries, formatSummary, formatEntry, autofillFixedExpensesForSaved,
} from './handlers/entry';
import {
    detectQueryDate, classifyQueryIntent, queryByDate, queryRecent,
    detectVendorMonthQuery, queryByVendorMonth,
    detectDateRangeQuery, queryByDateRange,
    detectDailyRevenueQuery, queryDailyRevenue,
    detectMonthYearQuery, queryByMonthYear,
    detectItemMonthQuery, queryByItemMonth,
    detectExpenseTypeMonthQuery, queryByExpenseTypeMonth,
    detectNoteQuery, queryByNote,
    detectRankingQuery, queryRanking,
    detectComparisonQuery, queryComparison,
} from './handlers/query';
import {
    runQuery, expenseGroups, periodFromOffset, periodForDay, periodFromCode,
    METRIC_LABEL, GROUPBY_LABEL, GROUPBYS_FOR,
    type QuerySpec, type Metric, type GroupBy,
} from './handlers/querySpec';
import { isQueryLike, translateQuestion } from './handlers/nlQuery';
import { saveAlias } from './aliases';
import type { SessionData, DbContext, ParsedEntry } from './types';

// ── 持久化 Log（寫入 /app/data/bot.log，方便事後查閱）──────────
const LOG_FILE = path.join(process.env.BOT_DATA_DIR ?? '/app/data', 'bot.log');
function logLine(tag: string, chatId: number | string, msg: string) {
    const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const line = `[${ts}] [${tag}] (${chatId}) ${msg}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore write errors */ }
    console.log(line.trimEnd());
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN 未設定，請檢查 .env');
    process.exit(1);
}

// T-ML-031：容器健康檢查心跳。跟 Telegram polling 能不能啟動成功無關，故意放在
// bot 物件建立之前就開始跑，越早開始寫心跳檔越好（細節見 bot/heartbeat.ts 檔頭註解）。
startHeartbeat();

// 啟動前先從 DB 拉回所有對話狀態（撐過 bot 重啟不丟進度）
// autoStart:false 讓我們先載入完狀態再開 polling
const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 2000,
        autoStart: false,
        params: { timeout: 30 },
    },
});

console.log('🤖 Bot 啟動中...');

(async () => {
    await preloadStates();
    // T-ML-026 (B)：啟動時打一次 claude-bridge /health，不通就 Telegram 告警給 owner
    // （isSuperAdmin，見 bot/bridgeHealth.ts）。只在啟動時檢查一次，不在每次解析時檢查
    // ——bot/parser.ts 本來就會每筆訊息無感 fallback 到 ollama，這裡只是加一層「該讓人
    // 知道」，過度告警本身就是一種擾民，所以刻意不做成常駐輪詢。
    await runStartupBridgeHealthCheck({
        sendAlert: async (chatId, text) => { await bot.sendMessage(chatId, text); },
    });
    await bot.startPolling();
    console.log('🤖 Bot polling started');
})().catch((err) => {
    console.error('[bot] startup failed:', err);
    process.exit(1);
});

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

*💤 休假日*（金額自動記 0、不列入日均）：
• \`潮州休假\`  \`屏東今天休假\`
• \`潮州 5/23 休假\`  \`屏東 3月17日 公休\`

*📊 查詢*：

_懶得打字就傳 /menu，常用查詢都做成按鈕了_

_📅 指定日期 / 最近_：
• \`今天\`  \`昨天\`  \`最近\`
• \`今天記了什麼\`  \`3/3 記錄\`

_🏪 廠商月份_：
• \`4月 阿明\`  \`查阿明4月\`
• \`阿明 4月叫了什麼\`

_📅➡️📅 範圍 + 地點_：
• \`3月1號到3月31號屏東的總營收\`
• \`4/1到4/8 萬丹進貨\`

_📊 整月 / 年度（新）_：
• \`本月\`  \`上月\`  \`今年\`  \`去年\`
• \`本月總營收\`  \`3月進貨\`
• \`2026年總收入\`  \`上月支出\`

_🍖 品項月份（新）_：
• \`本月豬肉\`  \`3月豬腳肉\`
• \`查 雞蛋 4月\`

_💸 支出類型月份（新）_：
• \`3月薪資\`  \`本月租金\`
• \`3月份薪資支出了多少\`
• \`上月瓦斯費用\`

_📝 備註查詢（新）_：
• \`3月份薪資備註小惠多少\`
• \`本月租金備註潮州\`
• \`上月薪資備註阿秀累積總共多少\`

_🏆 排行 TOP（新）_：
• \`本月TOP5廠商\`  \`本月最大廠商\`
• \`本月熱賣品項\`  \`3月攤位排行\`
• \`4月最熱賣商品TOP3\`

_🔄 同比 / 環比（新）_：
• \`本月跟上月比\`  \`環比\`
• \`3月對比2月\`  \`4月跟3月比\`
• \`同比\` — 本月 vs 去年同月

*🔧 指令*：
• /menu — **按鈕選單**（不用記指令，點就好）
• /today — 今天記錄
• /mute — 切換靜音模式（品項已知直接記錄，不詢問廠商）
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

// ── 建立支出類型選擇鍵盤 ────────────────────────────────────────
function buildExpenseTypeKeyboard(expenseTypes: { value: string; label: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < expenseTypes.length; i += 2) {
        rows.push(expenseTypes.slice(i, i + 2).map(et => ({
            text: et.label,
            callback_data: `expense_type_select_${et.value}`,
        })));
    }
    rows.push([{ text: '➕ 新增支出類型', callback_data: 'new_expense_create' }]);
    rows.push([{ text: '❌ 略過', callback_data: 'new_item_no' }]);
    return { inline_keyboard: rows };
}

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
// allowCreate=true：加入「➕ 新增廠商」按鈕（新建品項後使用）
function buildVendorKeyboard(vendors: { id: string; name: string }[], allowCreate = false) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < vendors.length; i += 2) {
        rows.push(vendors.slice(i, i + 2).map(v => ({
            text: v.name,
            callback_data: `vendor_select_${v.id}`,
        })));
    }
    if (allowCreate) {
        rows.push([{ text: '➕ 新增廠商', callback_data: 'vendor_create_prompt' }]);
    }
    rows.push([{ text: '⬜ 不填廠商', callback_data: 'vendor_skip' }]);
    return { inline_keyboard: rows };
}

// ── 建立品項選擇鍵盤（多相似品項時使用）────────────────────────
function buildItemKeyboard(items: { id: string; name: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < items.length; i += 2) {
        rows.push(items.slice(i, i + 2).map(item => ({
            text: item.name,
            callback_data: `item_select_${item.id}`,
        })));
    }
    rows.push([{ text: '➕ 新增品項', callback_data: 'new_purchase_create' }]);
    rows.push([{ text: '❌ 略過', callback_data: 'new_item_no' }]);
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
    // EXPENSE 找不到支出類型 → 顯示所有支出類型讓使用者選
    if (accepted.type === 'EXPENSE' && !accepted.expenseType) {
        removeLastConfirmed(chatId);
        const suggestedName = accepted.itemName ?? '';
        enterNewItemFlow(chatId, { entry: accepted, suggestedName, nextUncertain: next });
        const hint = suggestedName ? `「${suggestedName}」屬於哪種支出？` : '請選擇支出類型：';
        await bot.sendMessage(chatId, hint, { reply_markup: buildExpenseTypeKeyboard(ctx.expenseTypes) });
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

// ── 靜音模式：品項已知直接記錄，不詢問廠商/確認 ────────────────
function applyMuteMode(entries: ParsedEntry[]): ParsedEntry[] {
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


// ── 查詢選單 v2（按鈕式）────────────────────────────────────────
// 設計：vault projects/market-ledger/design/2026-09-03-query-system-v2
//
// 兩層：捷徑列（依 log 真實頻率）+ 進階查詢三步組合器（指標 → 期間 → 切法）。
// 三步全部走同一個 QuerySpec 引擎（handlers/querySpec.ts），不用一顆按鈕寫一個 handler。
//
// owner 2026-09-03 的核心要求：「得出答案後，按鈕選單還是要在下面，不用往上滑」。
// 做法：**每則結果訊息本身就掛著按鈕**（換切法／換期間／換指標／回選單），
// 而不是另發一則選單。最新那則永遠有按鈕。導覽（換頁）才用原地編輯。
//
// callback_data 上限 64 bytes，且 ChatState 不存草稿 —— 每顆按鈕自帶完整參數：
//   q:root                         首頁
//   q:s1                           步驟1：選指標
//   q:m:<metric>                   → 步驟2：選期間
//   q:p:<metric>:<pcode>           → 步驟3：選切法
//   q:r:<metric>:<pcode>:<groupBy> 執行（結果掛切法鍵盤）
//   q:c:<metric>:<pcode>           與上一期比較
//   q:pd / q:pm:<metric>           挑日期（近7天）/ 挑月份（近6個月）
//   q:x:<pcode>:<values>           支出某類型逐筆（下鑽）
//   q:n:<pcode>:<note>             支出某備註（人）逐筆（下鑽）
//   q:sal:<pcode>                  薪資依人（捷徑）
//   q:sn:<pcode>:<note>            某人薪資逐筆（下鑽）
// pcode：d0 今天 d1 昨天 d2 前天 w0 本週 w1 上週 m0 本月 m1 上月 … y0 今年 y1 去年

type Btn = { text: string; callback_data: string };
const CB_LIMIT = 64;
function cbOk(cb: string): boolean { return Buffer.byteLength(cb, 'utf8') <= CB_LIMIT; }

const MENU_ROOT_TEXT = '📊 *想查什麼？*\n_也可以直接打字，例如「8月薪水」「8月每天營業額」_';

function buildRootMenu() {
    return {
        inline_keyboard: [
            [
                { text: '📅 今天記了什麼', callback_data: 'q:r:entries:d0:none' },
                { text: '📅 昨天記了什麼', callback_data: 'q:r:entries:d1:none' },
            ],
            [{ text: '📆 挑日期…', callback_data: 'q:pd' }],
            [
                { text: '💵 本月薪資·依人', callback_data: 'q:sal:m0' },
                { text: '💸 本月支出', callback_data: 'q:r:expense:m0:expenseType' },
            ],
            [
                { text: '💰 本月每日營業額', callback_data: 'q:r:revenue:m0:day' },
                { text: '🛒 本月進貨', callback_data: 'q:r:purchase:m0:vendor' },
            ],
            [{ text: '🔧 進階查詢（自己組合）', callback_data: 'q:s1' }],
        ],
    };
}

const METRIC_BTNS: Btn[] = [
    { text: '💰 營業額', callback_data: 'q:m:revenue' },
    { text: '🛒 進貨', callback_data: 'q:m:purchase' },
    { text: '💸 支出', callback_data: 'q:m:expense' },
    { text: '📈 淨利', callback_data: 'q:m:profit' },
    { text: '📋 全部記錄', callback_data: 'q:m:entries' },
];

function buildMetricMenu() {
    return {
        inline_keyboard: [
            [METRIC_BTNS[0], METRIC_BTNS[1]],
            [METRIC_BTNS[2], METRIC_BTNS[3]],
            [METRIC_BTNS[4]],
            [{ text: '🏠 選單', callback_data: 'q:root' }],
        ],
    };
}

const PERIOD_BTNS: [string, string][] = [
    ['今天', 'd0'], ['昨天', 'd1'], ['本週', 'w0'], ['上週', 'w1'],
    ['本月', 'm0'], ['上月', 'm1'], ['今年', 'y0'], ['去年', 'y1'],
];

function buildPeriodMenu(metric: Metric) {
    const rows: Btn[][] = [];
    for (let i = 0; i < PERIOD_BTNS.length; i += 4) {
        rows.push(PERIOD_BTNS.slice(i, i + 4).map(([t, c]) => ({ text: t, callback_data: `q:p:${metric}:${c}` })));
    }
    rows.push([{ text: '📅 挑月份…', callback_data: `q:pm:${metric}` }]);
    rows.push([
        { text: '⬅️ 換指標', callback_data: 'q:s1' },
        { text: '🏠 選單', callback_data: 'q:root' },
    ]);
    return { inline_keyboard: rows };
}

function buildPickMonthMenu(metric: Metric) {
    const rows: Btn[][] = [];
    const btns: Btn[] = [];
    for (let off = 0; off < 6; off++) {
        btns.push({ text: periodFromOffset(off).label.replace(/^\d{4}年/, ''), callback_data: `q:p:${metric}:m${off}` });
    }
    rows.push(btns.slice(0, 3), btns.slice(3, 6));
    rows.push([{ text: '⬅️ 返回', callback_data: `q:m:${metric}` }, { text: '🏠 選單', callback_data: 'q:root' }]);
    return { inline_keyboard: rows };
}

function buildPickDateMenu() {
    const rows: Btn[][] = [];
    const btns: Btn[] = [];
    for (let off = 0; off < 7; off++) {
        const p = periodForDay(off);
        const label = off < 3 ? p.label.replace(/（.*）/, '') : `${p.from.getMonth() + 1}/${p.from.getDate()} ${['日','一','二','三','四','五','六'][p.from.getDay()]}`;
        btns.push({ text: label, callback_data: `q:r:entries:d${off}:none` });
    }
    rows.push(btns.slice(0, 3), btns.slice(3, 7));
    rows.push([{ text: '🏠 選單', callback_data: 'q:root' }]);
    return { inline_keyboard: rows };
}

/** 步驟3：切法（依指標動態）。同時也是「結果訊息下方」的鍵盤，active 那顆標 ● */
function buildGroupByKeyboard(metric: Metric, pcode: string, active?: string) {
    const rows: Btn[][] = [];
    const opts = GROUPBYS_FOR[metric];
    const btns: Btn[] = opts.map(g => ({
        text: `${active === g ? '● ' : ''}${GROUPBY_LABEL[g]}`,
        callback_data: `q:r:${metric}:${pcode}:${g}`,
    }));
    if (metric !== 'entries') {
        btns.push({ text: `${active === 'compare' ? '● ' : ''}vs 上期`, callback_data: `q:c:${metric}:${pcode}` });
    }
    if (metric !== 'entries' && metric !== 'profit') {
        btns.push({ text: `${active === 'list' ? '● ' : ''}逐筆明細`, callback_data: `q:r:${metric}:${pcode}:list` });
    }
    for (let i = 0; i < btns.length; i += 3) rows.push(btns.slice(i, i + 3));
    rows.push([
        { text: '⬅️ 換期間', callback_data: `q:m:${metric}` },
        { text: '🔧 換指標', callback_data: 'q:s1' },
        { text: '🏠 選單', callback_data: 'q:root' },
    ]);
    return { inline_keyboard: rows };
}

/** 單日「記了什麼」結果的鍵盤：直接換天，不用回選單 */
function buildDayResultKeyboard(activeOff: number) {
    const mk = (off: number, t: string): Btn => ({ text: `${activeOff === off ? '● ' : ''}${t}`, callback_data: `q:r:entries:d${off}:none` });
    return {
        inline_keyboard: [
            [mk(0, '今天'), mk(1, '昨天'), mk(2, '前天')],
            [{ text: '📆 挑日期…', callback_data: 'q:pd' }, { text: '🏠 選單', callback_data: 'q:root' }],
        ],
    };
}

/**
 * 支出結果的下鑽鍵盤：依類型 → 每個類型一顆按鈕點進逐筆；依人 → 每個人一顆。
 * 這是媽媽第三高頻的問題（「薪資備註小惠累積多少」），做成一鍵。
 */
function buildExpenseDrillKeyboard(
    metric: Metric, pcode: string, active: string,
    groups: { key: string; sum: number; values: string[] }[],
    kind: 'type' | 'note' | 'salary',
) {
    const base = buildGroupByKeyboard(metric, pcode, active);
    const drill: Btn[] = [];
    for (const g of groups.slice(0, 12)) {
        let cb = '';
        if (kind === 'type') cb = `q:x:${pcode}:${g.values.join(',')}`;
        else if (kind === 'note') cb = `q:n:${pcode}:${g.key}`;
        else cb = `q:sn:${pcode}:${g.key}`;
        if (!cbOk(cb) || g.key.startsWith('（')) continue;   // 太長或「（無備註）」不做按鈕
        drill.push({ text: `${g.key} $${Math.round(Math.abs(g.sum)).toLocaleString()}`, callback_data: cb });
    }
    const rows: Btn[][] = [];
    for (let i = 0; i < drill.length; i += 2) rows.push(drill.slice(i, i + 2));
    return { inline_keyboard: [...rows, ...base.inline_keyboard] };
}

/** 從 pcode 算「上一期」：m0→m1、d1→d2、w0→w1、y0→y1 */
function previousPeriodCode(pcode: string): string {
    const m = pcode.match(/^([dwmy])(\d+)$/);
    return m ? `${m[1]}${Number(m[2]) + 1}` : pcode;
}

function salaryValues(ctx: DbContext): string[] {
    return ctx.expenseTypes.filter(x => /薪資|薪水/.test(x.label)).map(x => x.value);
}

// ── 意圖釐清鍵盤（有日期但看不出是查詢還是記帳時使用）────────────
const INTENT_CLARIFY_KEYBOARD = {
    inline_keyboard: [[
        { text: '🔍 查詢', callback_data: 'intent_query' },
        { text: '📝 記帳', callback_data: 'intent_entry' },
    ]],
};

// ── 日期查詢：把指定日期的記錄回給使用者 ────────────────────────
// preloaded：呼叫端已經載好 ctx 時直接沿用，避免同一則訊息重複打 DB
async function runDateQuery(chatId: number, session: SessionData, text: string, preloaded?: DbContext): Promise<void> {
    const dateResult = detectQueryDate(text);
    logLine('QUERY', chatId, `date=${dateResult === 'recent' ? 'recent' : dateResult?.toLocaleDateString('zh-TW') ?? 'null'}`);
    const ctx = preloaded ?? await loadDbContext(session.tenantId);
    if (dateResult === 'recent') {
        await bot.sendMessage(chatId, await queryRecent(session, ctx));
    } else if (dateResult) {
        await bot.sendMessage(chatId, await queryByDate(dateResult, session, ctx));
    } else {
        // classifyQueryIntent 判為查詢但這裡拿不到日期（理論上不會發生）
        await bot.sendMessage(chatId, '❓ 看不出你要查哪一天，可以說「今天」「昨天」或「8/29」。');
    }
}

// ── 自然語言查詢（Phase 4）───────────────────────────────────────
// 只有通過 isQueryLike 閘門的句子才會到這裡（記帳不會）。LLM 只產 QuerySpec 草稿，
// 驗證/實體解析在 handlers/nlQuery，執行在 handlers/querySpec —— 跟按鈕同一個引擎。
async function runNlQuery(chatId: number, session: SessionData, text: string, ctx: DbContext): Promise<void> {
    logLine('NLQ', chatId, text.slice(0, 120));
    await bot.sendMessage(chatId, '🧠 理解中…');
    const diag = newParseDiagnostics();
    const t = await translateQuestion(text, ctx, diag);

    if (t.kind === 'unavailable') {
        logLine('NLQ', chatId, `unavailable: ${t.reason}`);
        await bot.sendMessage(chatId,
            '這句我翻不出來。可以換個說法，或用按鈕選：',
            { reply_markup: buildRootMenu() });
        return;
    }
    const fallbackNote = t.provider === 'ollama' ? '\n⚠️ 備援模型解讀，請核對' : '';
    if (t.kind === 'clarify') {
        logLine('NLQ', chatId, `clarify: ${t.question}`);
        await bot.sendMessage(chatId, `🤔 ${t.question}${fallbackNote}`, { reply_markup: buildRootMenu() });
        return;
    }
    logLine('NLQ', chatId, `spec: ${JSON.stringify({ ...t.spec, period: t.spec.period.label, compareTo: t.spec.compareTo?.label })}`);
    let result: string;
    try {
        result = await runQuery(t.spec, session, ctx);
    } catch (e) {
        console.error('[NLQ] runQuery error', e);
        await bot.sendMessage(chatId, '⚠️ 查詢時發生錯誤，請再試一次。', { reply_markup: buildRootMenu() });
        return;
    }
    await bot.sendMessage(chatId, `🧠 我理解成：${t.restate}${fallbackNote}\n\n${result}`, {
        reply_markup: { inline_keyboard: [[{ text: '🏠 選單', callback_data: 'q:root' }]] },
    });
}

// ── 記帳解析：原本 message handler 的尾段，抽出來讓意圖釐清也能重用 ──
async function runEntryParse(chatId: number, session: SessionData, text: string, preloaded?: DbContext): Promise<void> {
    logLine('PARSE', chatId, text.slice(0, 120));
    await bot.sendMessage(chatId, '🔄 解析中，請稍候...');

    const ctx = preloaded ?? await loadDbContext(session.tenantId);
    const diag = newParseDiagnostics();
    const rawEntries = await parseEntries(text, ctx, diag);

    if (rawEntries.length === 0) {
        await bot.sendMessage(chatId,
            '❓ 無法解析輸入內容。\n\n請確認格式，例如：\n`肝連2.6台斤218`\n\n或傳 /help 查看說明',
            { parse_mode: 'Markdown' });
        return;
    }

    // 逐筆 enrichment
    const enrichedRaw = await Promise.all(rawEntries.map(e => enrichEntry(e, ctx)));

    // 靜音模式：品項已知則強制 confident，跳過廠商選擇與二次確認
    let enriched = getState(chatId).muteMode ? applyMuteMode(enrichedRaw) : enrichedRaw;

    // 2026-08-30：主要模型（claude-bridge）失敗退回 ollama 時，一律強制二次確認。
    // ollama 實測正確率 4/10，且 8/29 曾憑空生出一筆不存在的營收；它的輸出不能
    // 跟 claude 一樣直接存進去。靜音模式也蓋掉 —— 這是正確性問題，不是吵不吵的問題。
    if (diag.usedFallback) {
        logLine('FALLBACK', chatId, `ollama fallback: ${diag.fallbackReason}`);
        enriched = enriched.map(e => ({
            ...e,
            confident: false,
            uncertainReason: e.uncertainReason
                ? `${e.uncertainReason}；⚠️ 備援模型解析，請確認`
                : '⚠️ 主要模型逾時，改用備援模型解析，請確認內容正確',
        }));
        await bot.sendMessage(chatId, '⚠️ 主要解析模型逾時，這批改用備援模型，請逐筆確認再存。');
    }

    const { confident, uncertain } = startConfirmation(chatId, enriched);

    if (uncertain.length === 0) {
        const { saved, failed } = await processEntries(confident, session, ctx);
        const summary = formatSummary(saved, failed, ctx);
        resetToIdle(chatId);
        await bot.sendMessage(chatId, summary);
        const fixedExpenseNotes = await autofillFixedExpensesForSaved(saved, session);
        for (const note of fixedExpenseNotes) {
            await bot.sendMessage(chatId, note);
        }
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
}

// ── 主要訊息處理 ──────────────────────────────────────────────
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    const text = (msg.text ?? '').trim();

    if (!telegramId || !text) return;

    logLine('IN', chatId, `[${msg.from?.username ?? telegramId}] ${text.slice(0, 120)}`);

    try {
    // ── handler body start ──────────────────────────────

    // 指令處理
    if (text === '/start') {
        const session = await getSession(telegramId);
        if (session) {
            await bot.sendMessage(chatId,
                `👋 你好，${session.realName || session.username}！已登入（${session.tenantName}）\n\n直接輸入記帳內容開始記錄。\n查資料就傳 /menu（按鈕選單），或 /help 看完整說明。`);
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

    // ── 查詢選單（需登入）────────────────────────────────
    if (text === '/menu' || text === '/查詢' || text === '選單') {
        const menuSession = await getSession(telegramId);
        if (!menuSession) {
            await bot.sendMessage(chatId, '請先登入。\n格式：`帳號 密碼`', { parse_mode: 'Markdown' });
            return;
        }
        await bot.sendMessage(chatId, MENU_ROOT_TEXT, {
            parse_mode: 'Markdown',
            reply_markup: buildRootMenu(),
        });
        return;
    }

    if (text === '/mute') {
        const current = getState(chatId).muteMode;
        setState(chatId, { muteMode: !current });
        await bot.sendMessage(chatId,
            !current
                ? '🔇 靜音模式已開啟\n品項已知時直接記錄，不再詢問廠商或二次確認。\n再傳 /mute 可關閉。'
                : '🔔 靜音模式已關閉\n恢復正常確認流程。',
        );
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
            // 2026-08-30：session 過期時這則訊息原本被直接丟掉，使用者登入後必須重打
            // （log 分析：33 次重新登入造成 41 則訊息被迫重打）。改成暫存下來，
            // 登入成功後自動重播。指令不暫存（重播 /help 沒有意義）。
            const worthReplaying = !text.startsWith('/');
            if (worthReplaying) {
                setState(chatId, { phase: 'awaiting_auth', pendingReplayText: text });
                await bot.sendMessage(chatId,
                    '🔑 登入已過期，請先登入。\n格式：`帳號 密碼`\n例如：`mom mom123`\n\n_登入後我會自動幫你送出剛才那則，不用重打。_',
                    { parse_mode: 'Markdown' });
            } else {
                setState(chatId, { phase: 'awaiting_auth' });
                await bot.sendMessage(chatId, '請先登入。\n格式：`帳號 密碼`\n例如：`mom mom123`', { parse_mode: 'Markdown' });
            }
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

        const replayText = getState(chatId).pendingReplayText;
        setState(chatId, { phase: 'idle', pendingReplayText: null });

        await bot.sendMessage(chatId,
            `✅ 登入成功，歡迎 ${newSession.realName || newSession.username}！\n帳戶：${newSession.tenantName}（${newSession.roleCode === 'admin' ? '管理員' : '一般'}）\n登入有效期 90 天。\n\n直接輸入記帳內容開始記錄。\n查資料就傳 /menu 叫出按鈕選單。`);

        // 把 session 過期時被擋下的那則訊息補送回自己，使用者不用重打。
        // 用 re-emit 而不是遞迴呼叫：這時 session 已存在，不會再走進上面這個分支，
        // 不會無限迴圈，而且完整重跑一次正常流程（查詢/記帳判斷都照舊）。
        if (replayText) {
            logLine('REPLAY', chatId, replayText.slice(0, 120));
            await bot.sendMessage(chatId, `↩️ 幫你送出剛才那則：「${replayText}」`);
            // node-telegram-bot-api 的型別把 emit 收斂成唯讀事件集合，明確轉型後重新派送
            (bot as unknown as NodeJS.EventEmitter).emit('message', { ...msg, text: replayText });
        }
        return;
    }

    // ── 等待意圖釐清中又收到新訊息 → 放掉舊的，照新訊息重新判斷（避免卡死）──
    if (state.phase === 'awaiting_intent_clarify') {
        setState(chatId, { phase: 'idle', pendingClarifyText: null });
    }

    // ── 等待支出項目確認（awaiting_new_expense，僅有按鈕互動）──
    if (state.phase === 'awaiting_new_expense') {
        if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
            const next = exitNewItemFlow(chatId);
            if (next) {
                const ctx2 = await loadDbContext(session.tenantId);
                await sendUncertainPrompt(chatId, next, 0, ctx2);
            } else {
                await finalizeEntries(chatId, session);
            }
        } else {
            await bot.sendMessage(chatId, '請點選上方按鈕確認是否新增支出項目，或輸入「略過」跳過。');
        }
        return;
    }

    // ── 等待輸入新廠商名稱（awaiting_new_vendor_input）────────
    if (state.phase === 'awaiting_new_vendor_input' && state.newItemPending) {
        const pending = state.newItemPending;
        if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
            addToConfirmed(chatId, { ...pending.entry, vendorId: null, vendorName: null });
            const next = exitNewItemFlow(chatId);
            if (next) {
                const ctx2 = await loadDbContext(session.tenantId);
                await sendUncertainPrompt(chatId, next, 0, ctx2);
            } else {
                await finalizeEntries(chatId, session);
            }
            return;
        }
        const vendorName = text.trim();
        try {
            const vendor = await prisma.vendor.create({
                data: { name: vendorName, isActive: true, tenantId: session.tenantId },
            });
            addToConfirmed(chatId, { ...pending.entry, vendorId: vendor.id, vendorName: vendor.name });
            await bot.sendMessage(chatId, `✅ 已新增廠商「${vendor.name}」。`);
        } catch {
            const existing = await prisma.vendor.findFirst({
                where: { name: vendorName, tenantId: session.tenantId },
            });
            if (existing) {
                addToConfirmed(chatId, { ...pending.entry, vendorId: existing.id, vendorName: existing.name });
                await bot.sendMessage(chatId, `✅ 廠商「${existing.name}」已存在，已使用。`);
            } else {
                addToConfirmed(chatId, { ...pending.entry, vendorId: null, vendorName: null });
                await bot.sendMessage(chatId, '❌ 新增廠商失敗，將不記錄廠商。');
            }
        }
        const next = exitNewItemFlow(chatId);
        if (next) {
            const ctx2 = await loadDbContext(session.tenantId);
            await sendUncertainPrompt(chatId, next, 0, ctx2);
        } else {
            await finalizeEntries(chatId, session);
        }
        return;
    }

    // ── 等待品項選擇（awaiting_item_select，僅有按鈕互動）────────
    if (state.phase === 'awaiting_item_select') {
        if (/^(略過|skip|跳過|取消|cancel)$/i.test(text)) {
            const next = exitNewItemFlow(chatId);
            if (next) {
                const ctx2 = await loadDbContext(session.tenantId);
                await sendUncertainPrompt(chatId, next, 0, ctx2);
            } else {
                await finalizeEntries(chatId, session);
            }
        } else {
            await bot.sendMessage(chatId, '請點選上方按鈕選擇品項，或點「❌ 略過」跳過。');
        }
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
        // 非確認詞 → 提示使用按鈕，不重置待確認記錄
        await bot.sendMessage(chatId, '⚠️ 請點選上方 ✅/❌ 按鈕確認，或輸入「略過」放棄本批記錄。');
        return;
    }

    // 查詢類 detector 共用同一份 ctx（原本每個分支各自 loadDbContext，重複打 DB；
    // 且 detectVendorMonthQuery 現在需要真實廠商清單才能判斷，必須先載好）
    const queryCtx = await loadDbContext(session.tenantId);

    // ── 日期範圍查詢（例如「3月1號到3月31號屏東攤位的總營收」）──
    const dateRange = detectDateRangeQuery(text);
    if (dateRange) {
        logLine('QUERY', chatId, `range=${dateRange.from.toLocaleDateString()}~${dateRange.to.toLocaleDateString()} loc=${dateRange.locationName || 'all'} type=${dateRange.type || 'all'}`);
        const result = await queryByDateRange(dateRange.from, dateRange.to, dateRange.locationName, dateRange.type, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 每日營業額明細（「8月每天營業額」「本月屏東每日」）──
    // 排在整月查詢之前：「8月營業額每天」否則會被 detectMonthYearQuery 先接走、只回總數
    const dailyRev = detectDailyRevenueQuery(text, queryCtx.locations);
    if (dailyRev) {
        logLine('QUERY', chatId, `dailyRevenue ${dailyRev.period.label} loc=${dailyRev.locationName ?? 'all'}`);
        const result = await queryDailyRevenue(dailyRev.period, dailyRev.locationId, dailyRev.locationName, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 廠商月份查詢（例如「4月 阿明」「查阿明4月進了什麼」）──
    const vendorMonth = detectVendorMonthQuery(text, queryCtx.vendors);
    if (vendorMonth) {
        logLine('QUERY', chatId, `vendor=${vendorMonth.vendorName} month=${vendorMonth.month}`);
        const result = await queryByVendorMonth(vendorMonth.vendorName, vendorMonth.month, vendorMonth.year, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 同比/環比查詢（例如「本月跟上月比」「3月對比2月」）──
    const comparison = detectComparisonQuery(text);
    if (comparison) {
        logLine('QUERY', chatId, `compare ${comparison.p1.label} vs ${comparison.p2.label}`);
        const result = await queryComparison(comparison.p1, comparison.p2, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 排行查詢 TOP N（例如「本月TOP5廠商」「3月最熱賣品項」）──
    const ranking = detectRankingQuery(text);
    if (ranking) {
        logLine('QUERY', chatId, `ranking ${ranking.target} top${ranking.topN} ${ranking.period.label}`);
        const result = await queryRanking(ranking.period, ranking.target, ranking.topN, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 品項月份 / 支出類型月份查詢 ──
    {
        const ctxForLookup = queryCtx;

        // 先試備註查詢（備註關鍵字優先，避免被普通支出類型攔截）
        const noteQ = detectNoteQuery(text, ctxForLookup.expenseTypes);
        if (noteQ) {
            logLine('QUERY', chatId, `expenseType=${noteQ.expenseTypeLabel} note=${noteQ.notePattern} period=${noteQ.period.label}`);
            const result = await queryByNote(noteQ.expenseTypeValue, noteQ.expenseTypeLabel, noteQ.notePattern, noteQ.period, session, ctxForLookup);
            await bot.sendMessage(chatId, result);
            return;
        }

        // 再試支出類型（薪資/租金/瓦斯/...）
        const expType = detectExpenseTypeMonthQuery(text, ctxForLookup.expenseTypes);
        if (expType) {
            logLine('QUERY', chatId, `expenseType=${expType.expenseTypeLabel} period=${expType.period.label}`);
            const result = await queryByExpenseTypeMonth(expType.expenseTypeValue, expType.expenseTypeLabel, expType.period, session, ctxForLookup);
            await bot.sendMessage(chatId, result);
            return;
        }

        // 再試品項
        const itemMonth = detectItemMonthQuery(text, ctxForLookup.items);
        if (itemMonth) {
            logLine('QUERY', chatId, `item=${itemMonth.itemName} period=${itemMonth.period.label}`);
            const result = await queryByItemMonth(itemMonth.itemId, itemMonth.itemName, itemMonth.period, session, ctxForLookup);
            await bot.sendMessage(chatId, result);
            return;
        }
    }

    // ── 整月/年度查詢（例如「3月總營收」「本月進貨」「2026年總收入」）──
    const monthYear = detectMonthYearQuery(text);
    if (monthYear) {
        logLine('QUERY', chatId, `monthYear ${monthYear.period.label} type=${monthYear.type || 'all'}`);
        const result = await queryByMonthYear(monthYear.period, monthYear.type, session, queryCtx);
        await bot.sendMessage(chatId, result);
        return;
    }

    // ── 意圖判斷：查詢 / 意圖不明 / 記帳 ───────────────────
    const intent = classifyQueryIntent(text);

    if (intent === 'query') {
        await runDateQuery(chatId, session, text, queryCtx);
        return;
    }

    // ── 自然語言查詢：regex 全沒接到、但看起來是在問問題 → 交給 LLM 翻成 QuerySpec ──
    if (isQueryLike(text)) {
        await runNlQuery(chatId, session, text, queryCtx);
        return;
    }

    // 有日期但看不出是查詢還是記帳 → 回頭問，絕不擅自走記帳路徑。
    // （2026-08-30：靜默降級曾讓 LLM 對查詢句「提取」出一筆不存在的營收）
    if (intent === 'ambiguous') {
        logLine('CLARIFY', chatId, text.slice(0, 120));
        setState(chatId, { phase: 'awaiting_intent_clarify', pendingClarifyText: text });
        await bot.sendMessage(chatId,
            `🤔 「${text}」我不確定你是要查詢還是要記帳，請選一個：`,
            { reply_markup: INTENT_CLARIFY_KEYBOARD });
        return;
    }

    await runEntryParse(chatId, session, text, queryCtx);
    // ── handler body end ────────────────────────────────
    } catch (err) {
        console.error('[MessageHandler Error]', err);
        try { await bot.sendMessage(chatId, '⚠️ 處理時發生錯誤，請重新輸入。'); } catch { /* ignore */ }
    }
});

// ── Inline Keyboard 回調 ──────────────────────────────────────
bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const telegramId = query.from.id;
    const data = query.data ?? '';

    if (!chatId) return;
    // answerCallbackQuery 可能因 query 過期（>30秒）而失敗，不讓它中斷後續流程
    try { await bot.answerCallbackQuery(query.id); } catch { /* query too old — ignore */ }

    try {
    // ── callback handler body start ─────────────────────

    const session = await getSession(telegramId);
    if (!session) {
        await bot.sendMessage(chatId, '會話已過期，請重新登入。');
        return;
    }

    const ctx = await loadDbContext(session.tenantId);
    const state = getState(chatId);

    // ── 查詢選單 v2 ────────────────────────────────────────────
    if (data.startsWith('q:')) {
        const parts = data.split(':');
        const kind = parts[1];
        const msgId = query.message?.message_id;

        // 導覽：原地換頁（失敗就發新訊息）
        const nav = async (text: string, markup: unknown) => {
            try {
                await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: markup as never });
            } catch {
                await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: markup as never });
            }
        };

        if (kind === 'root') { await nav(MENU_ROOT_TEXT, buildRootMenu()); return; }
        if (kind === 's1') { await nav('🔧 *進階查詢* — 第 1 步：查什麼？', buildMetricMenu()); return; }
        if (kind === 'm') {
            const metric = parts[2] as Metric;
            await nav(`🔧 *${METRIC_LABEL[metric]}* — 第 2 步：哪段時間？`, buildPeriodMenu(metric));
            return;
        }
        if (kind === 'pm') { await nav('📅 挑月份', buildPickMonthMenu(parts[2] as Metric)); return; }
        if (kind === 'pd') { await nav('📆 挑日期（近 7 天）', buildPickDateMenu()); return; }
        if (kind === 'p') {
            const metric = parts[2] as Metric;
            const pcode = parts[3];
            const period = periodFromCode(pcode);
            if (!period) { await bot.sendMessage(chatId, '期間代碼不對，請重開 /menu。'); return; }
            await nav(`🔧 *${period.label} · ${METRIC_LABEL[metric]}* — 第 3 步：怎麼看？`, buildGroupByKeyboard(metric, pcode));
            return;
        }

        // 執行類：結果一律「新訊息 + 掛鍵盤」
        let result = '';
        let markup: unknown = buildRootMenu();
        try {
            if (kind === 'r' || kind === 'c') {
                const metric = parts[2] as Metric;
                const pcode = parts[3];
                const period = periodFromCode(pcode);
                if (!period) throw new Error(`bad pcode ${pcode}`);

                if (kind === 'c') {
                    const prev = periodFromCode(previousPeriodCode(pcode))!;
                    result = await runQuery({ metric, period, compareTo: prev }, session, ctx);
                    markup = buildGroupByKeyboard(metric, pcode, 'compare');
                } else {
                    const g = parts[4];
                    const spec: QuerySpec = g === 'list'
                        ? { metric, period, agg: 'list' }
                        : { metric, period, groupBy: g as GroupBy };
                    result = await runQuery(spec, session, ctx);

                    if (metric === 'entries') {
                        const off = Number(pcode.replace(/^d/, ''));
                        markup = /^d\d+$/.test(pcode) ? buildDayResultKeyboard(off) : buildGroupByKeyboard(metric, pcode, g);
                    } else if (metric === 'expense' && (g === 'expenseType' || g === 'note')) {
                        const groups = await expenseGroups(spec, g, session, ctx);
                        markup = buildExpenseDrillKeyboard(metric, pcode, g, groups, g === 'expenseType' ? 'type' : 'note');
                    } else {
                        markup = buildGroupByKeyboard(metric, pcode, g);
                    }
                }
            } else if (kind === 'sal') {
                // 捷徑：薪資依人
                const pcode = parts[2];
                const period = periodFromCode(pcode)!;
                const spec: QuerySpec = { metric: 'expense', period, groupBy: 'note', filters: { expenseTypeValues: salaryValues(ctx) } };
                result = await runQuery(spec, session, ctx);
                const groups = await expenseGroups(spec, 'note', session, ctx);
                markup = buildExpenseDrillKeyboard('expense', pcode, 'note', groups, 'salary');
            } else if (kind === 'x') {
                // 下鑽：某支出類型逐筆
                const pcode = parts[2];
                const values = (parts.slice(3).join(':')).split(',').filter(Boolean);
                const period = periodFromCode(pcode)!;
                result = await runQuery({ metric: 'expense', period, agg: 'list', filters: { expenseTypeValues: values } }, session, ctx);
                markup = buildGroupByKeyboard('expense', pcode, 'expenseType');
            } else if (kind === 'n' || kind === 'sn') {
                // 下鑽：某人（備註）逐筆；sn = 限薪資
                const pcode = parts[2];
                const note = parts.slice(3).join(':');
                const period = periodFromCode(pcode)!;
                const filters: QuerySpec['filters'] = { notePattern: note };
                if (kind === 'sn') filters.expenseTypeValues = salaryValues(ctx);
                result = await runQuery({ metric: 'expense', period, agg: 'list', filters }, session, ctx);
                markup = buildGroupByKeyboard('expense', pcode, 'note');
            } else {
                result = '這個按鈕我不認得，請重開 /menu。';
            }
        } catch (e) {
            console.error('[Menu v2 error]', data, e);
            result = '⚠️ 查詢時發生錯誤，請再試一次或改用打字查詢。';
        }

        logLine('MENU', chatId, data);
        await bot.sendMessage(chatId, result, { reply_markup: markup as never });
        return;
    }

    // ── 意圖釐清：使用者選「查詢」還是「記帳」──────────────────
    if (data === 'intent_query' || data === 'intent_entry') {
        const pendingText = state.pendingClarifyText;
        setState(chatId, { phase: 'idle', pendingClarifyText: null });
        if (!pendingText) {
            await bot.sendMessage(chatId, '這則訊息已經過期了，請重新輸入一次。');
            return;
        }
        if (data === 'intent_query') {
            await runDateQuery(chatId, session, pendingText);
        } else {
            await runEntryParse(chatId, session, pendingText);
        }
        return;
    }

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

    // ── 從相似品項中選擇 ─────────────────────────────────────
    if (data.startsWith('item_select_')) {
        const pending = state.newItemPending;
        if (!pending) return;
        const itemId = data.replace('item_select_', '');
        const item = ctx.items.find(i => i.id === itemId);
        if (!item) {
            await bot.sendMessage(chatId, '❌ 找不到該品項，請重新選擇。');
            return;
        }

        // 用選定品項重新做 enrichment（主要是補廠商推斷）
        const { enrichEntry: enrich } = await import('./matcher');
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
                    { text: '✅ 新增廠商', callback_data: 'vendor_create' },
                    { text: '⬜ 不填廠商', callback_data: 'vendor_skip' },
                ]] } },
            );
        } else {
            addToConfirmed(chatId, enriched2);
            setState(chatId, {
                phase: savedNext ? 'awaiting_confirmation' : 'idle',
                newItemPending: null,
                currentUncertain: savedNext,
            });
            if (savedNext) await sendUncertainPrompt(chatId, savedNext, 0, ctx);
            else await finalizeEntries(chatId, session);
        }
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
        const savedNextUncertain = pending.nextUncertain;

        try {
            const newItemId = await createItem(session.tenantId, itemName, categoryId, defaultUnit);
            const category = ctx.categories.find(c => c.id === categoryId);
            const updatedEntry: ParsedEntry = { ...pending.entry, itemId: newItemId, itemName };

            await bot.sendMessage(chatId, `✅ 已新增品項「${itemName}」（分類：${category?.name ?? categoryId}）`);

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
                    await sendUncertainPrompt(chatId, savedNextUncertain, 0, ctx);
                } else {
                    await finalizeEntries(chatId, session, ctx);
                }
            }
        } catch (e) {
            await bot.sendMessage(chatId, `❌ 新增品項失敗：${e}`);
            const next = exitNewItemFlow(chatId);
            if (next) await sendUncertainPrompt(chatId, next, 0, ctx);
            else await finalizeEntries(chatId, session, ctx);
        }
        return;
    }

    // ── 廠商：提示輸入新廠商名稱（新建品項後） ─────────────────
    if (data === 'vendor_create_prompt') {
        const pending = state.newItemPending;
        if (!pending) return;
        setState(chatId, { phase: 'awaiting_new_vendor_input' });
        await bot.sendMessage(chatId, '請輸入新廠商名稱（或輸入「略過」不填廠商）：');
        return;
    }

    // ── 選擇已有支出類型 → 顯示最終確認 ──────────────────────
    if (data.startsWith('expense_type_select_')) {
        const pending = state.newItemPending;
        if (!pending) return;
        const value = data.replace('expense_type_select_', '');
        const et = ctx.expenseTypes.find(e => e.value === value);
        if (!et) { await bot.sendMessage(chatId, '❌ 找不到該支出類型'); return; }

        // 更新 pending entry（含支出類型），顯示確認訊息讓使用者最終確認
        const finalEntry = { ...pending.entry, expenseType: value };
        setState(chatId, {
            phase: 'awaiting_new_expense',
            newItemPending: { ...pending, entry: finalEntry },
        });
        const display = formatEntry(finalEntry, ctx);
        await bot.sendMessage(chatId,
            `📋 即將儲存：\n*${display}*\n\n確認儲存嗎？`,
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[
                    { text: '✅ 確認儲存', callback_data: 'expense_save_confirm' },
                    { text: '↩️ 重選類型', callback_data: 'expense_reselect' },
                    { text: '❌ 取消', callback_data: 'new_item_no' },
                ]] },
            },
        );
        return;
    }

    // ── 支出：確認儲存 ────────────────────────────────────────
    if (data === 'expense_save_confirm') {
        const pending = state.newItemPending;
        if (!pending) return;
        addToConfirmed(chatId, pending.entry);
        const next = exitNewItemFlow(chatId);
        if (next) await sendUncertainPrompt(chatId, next, 0, ctx);
        else await finalizeEntries(chatId, session);
        return;
    }

    // ── 支出：重選類型 ────────────────────────────────────────
    if (data === 'expense_reselect') {
        const pending = state.newItemPending;
        if (!pending) return;
        const hint = pending.entry.itemName ? `「${pending.entry.itemName}」屬於哪種支出？` : '請選擇支出類型：';
        await bot.sendMessage(chatId, hint, { reply_markup: buildExpenseTypeKeyboard(ctx.expenseTypes) });
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
        // Guard: if state was lost (bot restart), inform user
        if (state.phase === 'idle' && !state.currentUncertain) {
            await bot.sendMessage(chatId, '⚠️ 暫存資料已過期（可能因機器人重啟），請重新輸入一次。');
            return;
        }
        const { accepted, next } = acceptCurrent(chatId);
        // 使用者確認了模糊比對 → 儲存 alias 供下次自動命中
        if (accepted?.type === 'PURCHASE' && accepted._originalSearchName && accepted.itemId && accepted.itemName) {
            saveAlias(session.tenantId, accepted._originalSearchName, accepted.itemId, accepted.itemName);
        }
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
    // ── callback handler body end ───────────────────────
    } catch (err) {
        console.error('[CallbackHandler Error]', err);
        try { await bot.sendMessage(chatId, '⚠️ 操作失敗，請重試。'); } catch { /* ignore */ }
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
        await bot.sendMessage(chatId, '⚠️ 沒有任何記錄被儲存。\n（可能是機器人重新啟動導致暫存資料遺失，請重新輸入一次）');
        return;
    }

    // 重新載入最新 ctx，確保新建品項/支出類型能正確顯示名稱
    const freshCtx = await loadDbContext(session.tenantId);
    const { saved, failed } = await processEntries(confirmed, session, freshCtx);
    const summary = formatSummary(saved, failed, freshCtx);
    await bot.sendMessage(chatId, summary);
    const fixedExpenseNotes = await autofillFixedExpensesForSaved(saved, session);
    for (const note of fixedExpenseNotes) {
        await bot.sendMessage(chatId, note);
    }
}

// ── 錯誤處理 ────────────────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('[Polling Error]', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('[Unhandled Rejection]', err);
});

console.log('✅ Bot 已啟動（polling 模式）');
