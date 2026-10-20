// handlers 共用的 bot / context 型別

import type TelegramBot from 'node-telegram-bot-api';
import type { SessionData, DbContext, ChatState } from '../types';

export type Bot = TelegramBot;

/** 一次 callback_query 的共用 context（已通過 session 驗證、已載入該租戶的 DbContext）。 */
export type CbCtx = {
    bot: Bot;
    query: TelegramBot.CallbackQuery;
    chatId: number;
    telegramId: number;
    data: string;
    session: SessionData;
    ctx: DbContext;
    /** callback 進來當下的對話狀態快照（後續 setState 不會改變這份） */
    state: ChatState;
};
