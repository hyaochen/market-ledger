// 會話管理 + 登入驗證

import crypto from 'crypto';
import prisma from '../src/lib/prisma';
import type { SessionData } from './types';

const SESSION_KEY_PREFIX = 'tg_session_';
const SESSION_DAYS = 7;

// 從 DB 讀取 Telegram 會話
export async function getSession(telegramId: number): Promise<SessionData | null> {
    try {
        const config = await prisma.systemConfig.findFirst({
            where: { key: `${SESSION_KEY_PREFIX}${telegramId}`, tenantId: null },
        });
        if (!config) return null;

        const data: SessionData = JSON.parse(config.value);
        if (new Date(data.expires) < new Date()) {
            // 過期，刪除
            await prisma.systemConfig.deleteMany({
                where: { key: `${SESSION_KEY_PREFIX}${telegramId}`, tenantId: null },
            });
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

// 儲存 Telegram 會話到 DB
export async function saveSession(telegramId: number, data: SessionData): Promise<void> {
    const key = `${SESSION_KEY_PREFIX}${telegramId}`;
    const value = JSON.stringify(data);
    // 用 findFirst + upsert pattern（SQLite 兼容）
    const existing = await prisma.systemConfig.findFirst({ where: { key, tenantId: null } });
    if (existing) {
        await prisma.systemConfig.update({ where: { id: existing.id }, data: { value } });
    } else {
        await prisma.systemConfig.create({ data: { key, value, tenantId: null } });
    }
}

// 清除 Telegram 會話
export async function clearSession(telegramId: number): Promise<void> {
    await prisma.systemConfig.deleteMany({
        where: { key: `${SESSION_KEY_PREFIX}${telegramId}`, tenantId: null },
    });
}

// 解析登入格式：支援 "mom mom123" / "mom/mom123" / "帳號mom 密碼mom123" 等
export function parseLoginInput(text: string): { username: string; password: string } | null {
    const t = text.trim();

    // 帳號XXX 密碼XXX（中文前綴，允許有或無空格）
    const zhMatch = t.match(/帳號\s*(\S+)\s+密碼\s*(\S+)/);
    if (zhMatch) return { username: zhMatch[1], password: zhMatch[2] };

    // mom/mom123
    const slashMatch = t.match(/^(\S+)\/(\S+)$/);
    if (slashMatch) return { username: slashMatch[1], password: slashMatch[2] };

    // mom mom123（空格分隔，只有兩個 token）
    const parts = t.split(/\s+/);
    if (parts.length === 2) return { username: parts[0], password: parts[1] };

    return null;
}

// SHA-256 密碼雜湊（與 Web 端一致）
function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// 登入驗證，成功回傳 SessionData，失敗回傳 null
export async function verifyLogin(username: string, password: string): Promise<SessionData | null> {
    const hashed = hashPassword(password);

    const user = await prisma.user.findFirst({
        where: { username, password: hashed, status: true },
        include: {
            roles: { include: { role: true } },
            tenant: true,
        },
    });

    if (!user || !user.tenantId) return null;
    if (user.tenant && !user.tenant.status) return null;

    // 取最高角色
    const roleCodes = user.roles.map(r => r.role.code);
    let roleCode = 'read';
    if (roleCodes.includes('admin')) roleCode = 'admin';
    else if (roleCodes.includes('write')) roleCode = 'write';

    const expires = new Date();
    expires.setDate(expires.getDate() + SESSION_DAYS);

    return {
        userId: user.id,
        tenantId: user.tenantId,
        username: user.username,
        realName: user.realName,
        roleCode,
        tenantName: user.tenant?.name ?? '',
        expires: expires.toISOString(),
    };
}
