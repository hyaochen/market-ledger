// T-ML-033：把 Telegram bot 收到的「原始訊息 + 路由判定 + LLM 解析結果 + 最終寫入結果」
// 落一份到 BotMessageLog，供之後離線評測解析器與 Jev 意圖閘門用（owner 2026-09-20 批准）。
// 資料只留本機 DB，不外傳、不上傳。
//
// 設計原則：
// 1. Fire-and-forget + try/catch：任何寫入失敗只 console.warn，絕不讓 bot 主流程因為
//    記 log 而拋錯或卡住。呼叫端對 logOutcome/logCallback 一律用 `void logXxx(...)`
//    不 await；logIncoming 則在少數需要拿 logId 存進 ChatState.pendingLogId 的呼叫點
//    用 await —— 這些呼叫點都在「使用者已經收到第一個回覆（例如『🔄 解析中』）之後」
//    才發生，本地 SQLite 一次 insert 通常 <5ms，不會造成使用者能感知的延遲。
// 2. 依賴注入（跟 src/lib/fixedExpenseAutofill.ts 的 EntryWriteDb 同一套慣例）：真正
//    的 DB 操作透過 BotMessageLogDb 介面注入，預設是包著真正 prisma 的
//    realBotMessageLogDb；單元測試改傳一個會 reject 的假 db，驗證「寫入失敗只 warn
//    不拋」。跟 EntryWriteDb 不同的地方：這裡把 db 參數放在「最後面、有預設值」而
//    不是「最前面、必填」——因為 messageLog 的呼叫點分散在 bot/index.ts 十幾個地方，
//    多數只在乎業務邏輯那組參數，defaulted 參數讓正式程式碼不用每個呼叫點都多寫一次
//    realBotMessageLogDb，同時測試仍能完全注入假 db。
// 3. parsedJson / finalJson 存 JSON 字串（跟 bot/state.ts 存 ChatState 的方式一致），
//    不拆欄位——這份表是給人事後用 scripts/export-bot-message-log.ts 撈出來離線評測，
//    不是給應用程式即時查詢用，不需要能 SQL WHERE 進 JSON 內部欄位。

import prisma from '../src/lib/prisma';

export type BotMessageRoute =
    | 'entry' | 'query' | 'dayoff' | 'command'
    | 'state_reply' | 'callback' | 'auth' | 'unparsed' | 'other';

export type BotMessageOutcome =
    | 'auto_saved' | 'awaiting_confirmation' | 'confirmed' | 'rejected'
    | 'new_item_flow' | 'clarify_intent' | 'query_ok' | 'query_fail'
    | 'ignored' | 'error';

export interface BotMessageLogRow {
    id: number;
}

export interface BotMessageLogCreateData {
    chatId: string;
    messageId?: number | null;
    telegramUserId?: string | null;
    tenantId?: string | null;
    text: string;
    route: BotMessageRoute;
    llmProvider?: string | null;
    parsedJson?: string | null;
    outcome?: BotMessageOutcome | null;
    finalJson?: string | null;
    refMessageId?: number | null;
}

export interface BotMessageLogUpdateData {
    outcome?: BotMessageOutcome | null;
    finalJson?: string | null;
}

/** 依賴注入介面：真正的 DB 操作透過這層注入，測試可以換成會 reject 的假物件。 */
export interface BotMessageLogDb {
    create(args: { data: BotMessageLogCreateData }): Promise<BotMessageLogRow>;
    update(args: { where: { id: number }; data: BotMessageLogUpdateData }): Promise<unknown>;
}

/** 生產環境預設實作：包一層真正的 prisma（跟 fixedExpenseAutofill.ts 的 realEntryDb 同款）。 */
export const realBotMessageLogDb: BotMessageLogDb = {
    create: (args) =>
        prisma.botMessageLog.create({
            data: args.data as Parameters<typeof prisma.botMessageLog.create>[0]['data'],
        }) as unknown as Promise<BotMessageLogRow>,
    update: (args) =>
        prisma.botMessageLog.update({
            where: args.where,
            data: args.data,
        }),
};

function safeStringify(value: unknown): string | null {
    if (value === undefined) return null;
    try {
        return JSON.stringify(value);
    } catch (err) {
        console.warn('[messageLog] JSON.stringify failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

export interface LogIncomingParams {
    chatId: number | string;
    messageId?: number | null;
    telegramUserId?: number | string | null;
    tenantId?: string | null;
    text: string;
    route: BotMessageRoute;
    llmProvider?: string | null;
    /** 事後修正過的 RawExtracted 陣列或其他解析結果，內部會 JSON.stringify。 */
    parsed?: unknown;
    outcome?: BotMessageOutcome | null;
    final?: unknown;
}

/**
 * 訊息進來、路由判定（+ LLM 解析完）後呼叫一次，寫入一列，回傳 logId。
 * 失敗一律回傳 null、只 console.warn，不拋錯——呼叫端不會因此中斷主流程。
 */
export async function logIncoming(
    params: LogIncomingParams,
    db: BotMessageLogDb = realBotMessageLogDb,
): Promise<number | null> {
    try {
        const row = await db.create({
            data: {
                chatId: String(params.chatId),
                messageId: params.messageId ?? null,
                telegramUserId: params.telegramUserId != null ? String(params.telegramUserId) : null,
                tenantId: params.tenantId ?? null,
                text: params.text,
                route: params.route,
                llmProvider: params.llmProvider ?? null,
                parsedJson: safeStringify(params.parsed),
                outcome: params.outcome ?? null,
                finalJson: safeStringify(params.final),
            },
        });
        return row.id;
    } catch (err) {
        console.warn('[messageLog] logIncoming failed:', err instanceof Error ? err.message : err);
        return null;
    }
}

/**
 * 用 logIncoming 回傳的 logId 回填最終結果（confirm_yes_/confirm_no_、新增品項流程
 * 結束時）。logId 是 null/undefined（例如當初 logIncoming 失敗，或這個 chat 從沒
 * 進過確認流程）時安靜跳過，不當成錯誤。
 */
export async function logOutcome(
    logId: number | null | undefined,
    outcome: BotMessageOutcome,
    final?: unknown,
    db: BotMessageLogDb = realBotMessageLogDb,
): Promise<void> {
    if (logId == null) return;
    try {
        await db.update({
            where: { id: logId },
            data: {
                outcome,
                ...(final !== undefined ? { finalJson: safeStringify(final) } : {}),
            },
        });
    } catch (err) {
        console.warn('[messageLog] logOutcome failed:', err instanceof Error ? err.message : err);
    }
}

export interface LogCallbackParams {
    chatId: number | string;
    telegramUserId?: number | string | null;
    tenantId?: string | null;
    text: string; // callback_data
    outcome?: BotMessageOutcome | null;
    final?: unknown;
    refMessageId?: number | null;
}

/**
 * Callback（按鈕點擊）進來但找不到對應的 pendingLogId 時使用——寫一筆新列，route
 * 固定 'callback'，refMessageId 記原始訊息 id 方便人工回溯，不強求一定串得起來。
 */
export async function logCallback(
    params: LogCallbackParams,
    db: BotMessageLogDb = realBotMessageLogDb,
): Promise<number | null> {
    try {
        const row = await db.create({
            data: {
                chatId: String(params.chatId),
                telegramUserId: params.telegramUserId != null ? String(params.telegramUserId) : null,
                tenantId: params.tenantId ?? null,
                text: params.text,
                route: 'callback',
                outcome: params.outcome ?? null,
                finalJson: safeStringify(params.final),
                refMessageId: params.refMessageId ?? null,
            },
        });
        return row.id;
    } catch (err) {
        console.warn('[messageLog] logCallback failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
