import prisma from "@/lib/prisma";

/**
 * 帳號名稱是否已被「任何租戶」使用（不分大小寫）。
 * schema 只有 @@unique([username, tenantId])，但登入是全域查 username，
 * 所以跨租戶同名會造成登入落到錯的租戶；新增/改名一律在這裡擋。
 * SQLite 的 lower() 只處理 ASCII，足夠（帳號以英數為主）。
 */
export async function usernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
    const rows = excludeUserId
        ? await prisma.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM "User" WHERE lower(username) = lower(${username}) AND id <> ${excludeUserId}`
        : await prisma.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(*) AS n FROM "User" WHERE lower(username) = lower(${username})`;
    return Number(rows[0]?.n ?? 0) > 0;
}

export const MIN_NEW_PASSWORD_LEN = 8;
export const MAX_PASSWORD_BYTES = 72; // bcrypt 只看前 72 bytes

/** 新密碼規則（建立使用者 / 建立企業 / 重設密碼共用）。回傳錯誤訊息，通過則回 null。 */
export function validateNewPassword(pw: string | null | undefined): string | null {
    if (!pw) return `請輸入密碼（至少 ${MIN_NEW_PASSWORD_LEN} 個字元）`;
    if (pw.length < MIN_NEW_PASSWORD_LEN) return `密碼至少需要 ${MIN_NEW_PASSWORD_LEN} 個字元`;
    if (Buffer.byteLength(pw, "utf8") > MAX_PASSWORD_BYTES) return `密碼過長（上限 ${MAX_PASSWORD_BYTES} bytes）`;
    return null;
}

export function validateUsername(u: string | null | undefined): string | null {
    if (!u) return "請輸入帳號";
    if (u.length > 64) return "帳號過長（上限 64 字元）";
    if (/\s/.test(u)) return "帳號不可包含空白";
    return null;
}
