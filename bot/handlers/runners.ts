// 查詢 / 記帳解析的執行函式（message handler 與 callback handler 共用）

import { loadDbContext, enrichEntry } from '../matcher';
import { parseEntries, newParseDiagnostics } from '../parser';
import { getState, setState, resetToIdle, startConfirmation } from '../state';
import { processEntries, formatSummary, formatEntry, autofillFixedExpensesForSaved } from './entry';
import { detectQueryDate, queryByDate, queryRecent } from './query';
import { runQuery } from './querySpec';
import { translateQuestion } from './nlQuery';
import { logIncoming, logOutcome } from '../messageLog';
import { applyJevMatch } from '../jevApply';
import { logLine } from '../botLog';
import { buildRootMenu } from './menu';
import { applyMuteMode, buildFinalPayload, jevMappingNote, sendUncertainPrompt } from './flow';
import type { SessionData, DbContext } from '../types';
import type { Bot } from './botTypes';

// T-ML-033：訊息處理裡一大串 regex 查詢 detector（dateRange/dailyRev/vendorMonth/...）
// 各自 inline 判斷、各自 sendMessage，沒有像 runDateQuery/runNlQuery 那樣被抽成獨立
// 函式。與其把它們全部重構，這裡開一個共用 logger，各 detector 命中時呼叫一行即可，
// 不改變原本的控制流程。route 固定 'query'——這些 detector 本身就是「查詢」分支，
// 差別只在用 regex 而非 LLM；有沒有查到東西看 result 是否為空字串。
export function logQueryBranch(
    chatId: number,
    messageId: number | undefined,
    telegramUserId: number | undefined,
    tenantId: string,
    text: string,
    detector: string,
    result: string,
): void {
    void logIncoming({
        chatId, messageId, telegramUserId, tenantId, text, route: 'query',
        parsed: { detector },
        outcome: result ? 'query_ok' : 'query_fail',
        final: { resultPreview: result.slice(0, 300) },
    });
}

// ── 日期查詢：把指定日期的記錄回給使用者 ────────────────────────
// preloaded：呼叫端已經載好 ctx 時直接沿用，避免同一則訊息重複打 DB
export async function runDateQuery(
    bot: Bot, chatId: number, session: SessionData, text: string, preloaded?: DbContext,
    messageId?: number, telegramUserId?: number,
): Promise<void> {
    const dateResult = detectQueryDate(text);
    logLine('QUERY', chatId, `date=${dateResult === 'recent' ? 'recent' : dateResult?.toLocaleDateString('zh-TW') ?? 'null'}`);
    const ctx = preloaded ?? await loadDbContext(session.tenantId);
    let result: string;
    if (dateResult === 'recent') {
        result = await queryRecent(session, ctx);
    } else if (dateResult) {
        result = await queryByDate(dateResult, session, ctx);
    } else {
        // classifyQueryIntent 判為查詢但這裡拿不到日期（理論上不會發生）
        result = '看不出你要查哪一天，可以說「今天」「昨天」或「8/29」。';
    }
    await bot.sendMessage(chatId, result);
    logQueryBranch(chatId, messageId, telegramUserId, session.tenantId, text, 'dateQuery', dateResult ? result : '');
}

// ── 自然語言查詢（Phase 4）───────────────────────────────────────
// 只有通過 isQueryLike 閘門的句子才會到這裡（記帳不會）。LLM 只產 QuerySpec 草稿，
// 驗證/實體解析在 handlers/nlQuery，執行在 handlers/querySpec —— 跟按鈕同一個引擎。
export async function runNlQuery(
    bot: Bot, chatId: number, session: SessionData, text: string, ctx: DbContext,
    messageId?: number, telegramUserId?: number,
): Promise<void> {
    logLine('NLQ', chatId, text.slice(0, 120));
    await bot.sendMessage(chatId, '理解中…');
    const diag = newParseDiagnostics();
    const t = await translateQuestion(text, ctx, diag);

    // T-ML-033：route='query'，跟規則式 query detector 共用同一個 route 值，用
    // outcome 區分成功/失敗；parsedJson 依 spec 要求放 translate 的 restate。
    const logBase = { chatId, messageId, telegramUserId, tenantId: session.tenantId, text, route: 'query' as const };

    if (t.kind === 'unavailable') {
        logLine('NLQ', chatId, `unavailable: ${t.reason}`);
        await bot.sendMessage(chatId,
            '這句我翻不出來。可以換個說法，或用按鈕選：',
            { reply_markup: buildRootMenu() });
        void logIncoming({ ...logBase, outcome: 'query_fail', parsed: { reason: t.reason } });
        return;
    }
    const fallbackNote = t.provider === 'ollama' ? '\n【注意】備援模型解讀，請核對' : '';
    if (t.kind === 'clarify') {
        logLine('NLQ', chatId, `clarify: ${t.question}`);
        await bot.sendMessage(chatId, `${t.question}${fallbackNote}`, { reply_markup: buildRootMenu() });
        void logIncoming({ ...logBase, llmProvider: t.provider, outcome: 'query_fail', parsed: { clarifyQuestion: t.question } });
        return;
    }
    logLine('NLQ', chatId, `spec: ${JSON.stringify({ ...t.spec, period: t.spec.period.label, compareTo: t.spec.compareTo?.label })}`);
    let result: string;
    try {
        result = await runQuery(t.spec, session, ctx);
    } catch (e) {
        console.error('[NLQ] runQuery error', e);
        await bot.sendMessage(chatId, '【注意】查詢時發生錯誤，請再試一次。', { reply_markup: buildRootMenu() });
        void logIncoming({
            ...logBase, llmProvider: t.provider, outcome: 'query_fail',
            parsed: { spec: t.spec, restate: t.restate }, final: { error: String(e) },
        });
        return;
    }
    await bot.sendMessage(chatId, `我理解成：${t.restate}${fallbackNote}\n\n${result}`, {
        reply_markup: { inline_keyboard: [[{ text: '選單', callback_data: 'q:root' }]] },
    });
    void logIncoming({
        ...logBase, llmProvider: t.provider, outcome: 'query_ok',
        parsed: { spec: t.spec, restate: t.restate }, final: { resultPreview: result.slice(0, 300) },
    });
}

// ── 記帳解析：原本 message handler 的尾段，抽出來讓意圖釐清也能重用 ──
export async function runEntryParse(
    bot: Bot, chatId: number, session: SessionData, text: string, preloaded?: DbContext,
    messageId?: number, telegramUserId?: number,
): Promise<void> {
    logLine('PARSE', chatId, text.slice(0, 120));
    await bot.sendMessage(chatId, '解析中，請稍候...');

    const ctx = preloaded ?? await loadDbContext(session.tenantId);
    const diag = newParseDiagnostics();
    const rawEntries = await parseEntries(text, ctx, diag);

    if (rawEntries.length === 0) {
        // T-ML-033：解析嘗試了但什麼都沒抽出來 → route='unparsed'（跟「有抽到東西」
        // 的 entry/dayoff 分開，方便離線評測抓 parser 漏抓的案例）。
        void logIncoming({
            chatId, messageId, telegramUserId, tenantId: session.tenantId, text,
            route: 'unparsed', llmProvider: diag.usedFallback ? 'ollama' : 'claude', outcome: 'ignored',
        });
        await bot.sendMessage(chatId,
            '無法解析輸入內容。\n\n請確認格式，例如：\n`肝連2.6台斤218`\n\n或傳 /help 查看說明',
            { parse_mode: 'Markdown' });
        return;
    }

    // T-ML-033：休假意圖是 parser.ts 的 pre-LLM 快速路徑（見 detectDayOffEntries），
    // 命中時整批都是 isDayOff，且完全沒呼叫 LLM → 用獨立的 route='dayoff' 標記，
    // llmProvider 留 null（沒有 LLM 參與）。parsedJson 記解析出來的核心欄位，供之後
    // 離線比對「這句話本來應該解析成什麼」。
    const isDayOffBatch = rawEntries.every(e => e.isDayOff);
    const llmProvider = isDayOffBatch ? null : (diag.usedFallback ? 'ollama' : 'claude');
    // 逐筆 enrichment
    const enrichedRaw = await Promise.all(rawEntries.map(e => enrichEntry(e, ctx)));

    // Jev 品項快速判斷（2026-10-09）：細節與 fail-open 見 jevApply.ts / jev.ts
    const jevApplied = await Promise.all(enrichedRaw.map((e, i) => applyJevMatch(text, rawEntries[i], e, ctx, enrichEntry)));
    const enrichedJev = jevApplied.map(r => r.entry);
    const jevResults = jevApplied.map(r => r.jev);

    const parsedForLog = rawEntries.map((e, i) => ({
        type: e.type, itemName: e.itemName, quantity: e.quantity, unit: e.unit,
        price: e.price, vendor: e.vendorName, note: e.note, date: e.date,
        ...(jevResults[i] ? { jev: jevResults[i] } : {}),
    }));
    const logId = await logIncoming({
        chatId, messageId, telegramUserId, tenantId: session.tenantId, text,
        route: isDayOffBatch ? 'dayoff' : 'entry', llmProvider, parsed: parsedForLog,
    });

    // 靜音模式：品項已知則強制 confident，跳過廠商選擇與二次確認
    let enriched = getState(chatId).muteMode ? applyMuteMode(enrichedJev) : enrichedJev;

    // 2026-08-30：主要模型（claude-bridge）失敗退回 ollama 時，一律強制二次確認。
    // ollama 實測正確率 4/10，且 8/29 曾憑空生出一筆不存在的營收；它的輸出不能
    // 跟 claude 一樣直接存進去。靜音模式也蓋掉 —— 這是正確性問題，不是吵不吵的問題。
    if (diag.usedFallback) {
        logLine('FALLBACK', chatId, `ollama fallback: ${diag.fallbackReason}`);
        enriched = enriched.map(e => ({
            ...e,
            confident: false,
            uncertainReason: e.uncertainReason
                ? `${e.uncertainReason}；【注意】備援模型解析，請確認`
                : '【注意】主要模型逾時，改用備援模型解析，請確認內容正確',
        }));
        await bot.sendMessage(chatId, '【注意】主要解析模型逾時，這批改用備援模型，請逐筆確認再存。');
    }

    const { confident, uncertain } = startConfirmation(chatId, enriched);
    // T-ML-033：這批的 logId 存進 pendingLogId，讓 confirm_yes_/confirm_no_ callback
    // 與新增品項流程（handleAcceptedEntry/finalizeEntries）之後能回填 outcome。
    setState(chatId, { pendingLogId: logId ?? undefined });

    if (uncertain.length === 0) {
        const { saved, failed } = await processEntries(confident, session, ctx);
        const summary = formatSummary(saved, failed, ctx);
        resetToIdle(chatId);
        void logOutcome(logId, saved.length > 0 ? 'auto_saved' : 'error', buildFinalPayload(saved, failed));
        await bot.sendMessage(chatId, summary + jevMappingNote(confident));
        const fixedExpenseNotes = await autofillFixedExpensesForSaved(saved, session);
        for (const note of fixedExpenseNotes) {
            await bot.sendMessage(chatId, note);
        }
    } else {
        void logOutcome(logId, 'awaiting_confirmation');
        if (confident.length > 0) {
            const preview = confident.map(e => `  • ${formatEntry(e, ctx)}`).join('\n');
            await bot.sendMessage(chatId, `以下 ${confident.length} 筆確認無誤，稍後儲存：\n${preview}${jevMappingNote(confident)}`);
        }
        const first = getState(chatId).currentUncertain;
        if (first) {
            await sendUncertainPrompt(bot, chatId, first, 0, ctx);
        }
    }
}
