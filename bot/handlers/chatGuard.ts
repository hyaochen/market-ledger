// 聊天類型限制：bot 只處理私訊。
//
// 群組裡密碼會貼給所有人且 bot 不是管理員時刪不掉；待重播文字與確認按鈕以聊天室為單位，
// 會串到別人身上。主控查過正式資料：bot 從來沒有被用在群組，所以直接擋掉。
// chat.type 缺少（undefined）一律當成非私訊（保守）。

import type TelegramBot from 'node-telegram-bot-api';
import { nonPrivateNoticeLimiter, NON_PRIVATE_NOTICE_TEXT } from '../rateLimit';
import type { Bot } from './botTypes';

export function isPrivateChat(chat: { type?: string } | null | undefined): boolean {
    return chat?.type === 'private';
}

// 「/start」「/help」，群組裡 Telegram 會帶「@botname」後綴
const NOTICE_COMMAND = /^\/(start|help)(@\w+)?$/;

/**
 * 非私訊聊天室的文字訊息：不查 session、不寫 DB、不呼叫 LLM、不刪訊息。
 * 只有 /start、/help 會回一句提示，同一個聊天室一小時一次。
 */
export async function handleNonPrivateMessage(bot: Bot, msg: TelegramBot.Message): Promise<void> {
    const text = (msg.text ?? '').trim();
    if (!NOTICE_COMMAND.test(text)) return;
    if (!nonPrivateNoticeLimiter.tryConsume(String(msg.chat.id)).allowed) return;
    try { await bot.sendMessage(msg.chat.id, NON_PRIVATE_NOTICE_TEXT); } catch { /* ignore */ }
}
