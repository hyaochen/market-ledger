// 持久化 log（預設寫入 /app/data/bot.log，方便事後查閱）+ 簡單輪替。
//
// 安全規則：呼叫端在「尚未登入」時不得把使用者原文丟進來（可能是「帳號 密碼」明文）。
// 登入路徑請用 redactLoginText() 取得可安全落地的字串。

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { parseLoginInput } from './auth';

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP_FILES = 2; // bot.log.1, bot.log.2

function logFilePath(): string {
    return path.join(process.env.BOT_DATA_DIR ?? '/app/data', 'bot.log');
}

// 大於上限就輪替：bot.log.2 刪掉 <- bot.log.1 <- bot.log。同步、失敗一律忽略。
export function rotateIfNeeded(file: string = logFilePath(), maxBytes: number = LOG_MAX_BYTES, keep: number = LOG_KEEP_FILES): boolean {
    try {
        const st = fs.statSync(file);
        if (st.size <= maxBytes) return false;
    } catch {
        return false; // 檔案不存在
    }
    try {
        for (let i = keep; i >= 1; i--) {
            const from = i === 1 ? file : `${file}.${i - 1}`;
            const to = `${file}.${i}`;
            if (!fs.existsSync(from)) continue;
            if (i === keep && fs.existsSync(to)) fs.unlinkSync(to);
            fs.renameSync(from, to);
        }
        return true;
    } catch {
        return false;
    }
}

export function logLine(tag: string, chatId: number | string, msg: string): void {
    const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const line = `[${ts}] [${tag}] (${chatId}) ${msg}\n`;
    try {
        const file = logFilePath();
        rotateIfNeeded(file);
        fs.appendFileSync(file, line);
    } catch { /* ignore write errors */ }
    console.log(line.trimEnd());
}

// 登入路徑的「帳號名稱」標記：log 與 BotMessageLog 一律不寫帳號名稱原文。
// 帳密順序打反時被當成帳號的那段其實是密碼，所以連帳號名稱也只留雜湊：
// `u#` + 小寫帳號名稱 sha256 的前 8 個十六進位字元（同一個帳號永遠同一個標記，方便對帳）。
export function usernameTag(username: string): string {
    return `u#${createHash('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 8)}`;
}

// 登入路徑專用：永遠不回傳密碼與帳號名稱原文。解析不出登入格式就給固定佔位字串。
export function redactLoginText(text: string): string {
    const credentials = parseLoginInput(text);
    return credentials ? `${usernameTag(credentials.username)} [password redacted]` : '[unrecognized login format]';
}
