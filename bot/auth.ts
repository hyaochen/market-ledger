// 會話管理 + 登入驗證

import prisma from '../src/lib/prisma';
import { hashPasswordAsync, verifyPassword } from '../src/lib/password';
import type { SessionData } from './types';

const SESSION_KEY_PREFIX = 'tg_session_';
// 2026-08-30：7 → 90 天。log 分析顯示重新登入的間隔幾乎全是整齊的 7 天
// （33 次重新登入），而每次過期都會吃掉使用者當下那則記帳訊息，累計 41 則被迫重打。
// 這是家用 bot，身分本來就綁在 Telegram 帳號上，7 天的安全收益遠低於它造成的損失。
const SESSION_DAYS = 90;

// 取最高角色（跟登入時同一套規則）
export function resolveRoleCode(roleCodes: string[]): string {
    if (roleCodes.includes('admin')) return 'admin';
    if (roleCodes.includes('write')) return 'write';
    return 'read';
}

type SessionUserRow = {
    status: boolean;
    tenantId: string | null;
    username: string;
    realName: string | null;
    roles: { role: { code: string } }[];
    tenant: { status: boolean; name: string } | null;
} | null;

// 用目前 DB 裡的使用者資料重新驗證一個既有 session（純函式，方便測試）。
// 回傳 null = 這個 session 不能再用（停用 / 刪除 / 換租戶 / 租戶停用 / 降成唯讀）；
// 否則回傳「角色與顯示名稱已刷新」的 session（到期日不變，維持 90 天）。
export function revalidateSession(session: SessionData, user: SessionUserRow): SessionData | null {
    if (!user || !user.status) return null;
    if (!user.tenantId || user.tenantId !== session.tenantId) return null;
    if (user.tenant && !user.tenant.status) return null;
    const roleCode = resolveRoleCode(user.roles.map(r => r.role.code));
    // 登入時唯讀帳號會被拒絕；被降成唯讀的既有 session 同樣不能再寫入
    if (roleCode === 'read') return null;
    return {
        ...session,
        username: user.username,
        realName: user.realName,
        roleCode,
        tenantName: user.tenant?.name ?? session.tenantName,
    };
}

// 從 DB 讀取 Telegram 會話；每次使用都重新驗證使用者（一個 query）
export async function getSession(telegramId: number): Promise<SessionData | null> {
    try {
        const key = `${SESSION_KEY_PREFIX}${telegramId}`;
        const config = await prisma.systemConfig.findFirst({
            where: { key, tenantId: null },
        });
        if (!config) return null;

        const data: SessionData = JSON.parse(config.value);
        if (new Date(data.expires) < new Date()) {
            // 過期，刪除
            await prisma.systemConfig.deleteMany({ where: { key, tenantId: null } });
            return null;
        }

        const user = await prisma.user.findUnique({
            where: { id: data.userId },
            select: {
                status: true, tenantId: true, username: true, realName: true,
                roles: { select: { role: { select: { code: true } } } },
                tenant: { select: { status: true, name: true } },
            },
        });
        const fresh = revalidateSession(data, user);
        if (!fresh) {
            await prisma.systemConfig.deleteMany({ where: { key, tenantId: null } });
            return null;
        }
        if (fresh.roleCode !== data.roleCode || fresh.username !== data.username
            || fresh.realName !== data.realName || fresh.tenantName !== data.tenantName) {
            await prisma.systemConfig.update({ where: { id: config.id }, data: { value: JSON.stringify(fresh) } });
        }
        return fresh;
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

// 解析登入格式：支援 "wang abcd1234" / "wang/abcd1234" / "帳號wang 密碼abcd1234" 等
export function parseLoginInput(text: string): { username: string; password: string } | null {
    const t = text.trim();

    // 帳號XXX 密碼XXX（中文前綴，允許有或無空格）
    const zhMatch = t.match(/帳號\s*(\S+)\s+密碼\s*(\S+)/);
    if (zhMatch) return { username: zhMatch[1], password: zhMatch[2] };

    // wang/abcd1234
    const slashMatch = t.match(/^(\S+)\/(\S+)$/);
    if (slashMatch) return { username: slashMatch[1], password: slashMatch[2] };

    // wang abcd1234（空格分隔，只有兩個 token）
    const parts = t.split(/\s+/);
    if (parts.length === 2) return { username: parts[0], password: parts[1] };

    return null;
}

// 登入驗證，成功回傳 SessionData，失敗回傳 null
export async function verifyLogin(username: string, password: string): Promise<SessionData | null> {
    // 以 username 查（不再用 password 當 WHERE 條件，改由 verifyPassword 比對）
    // orderBy：username 只在租戶內唯一，同名時要有確定的結果（最早建立者優先）
    const user = await prisma.user.findFirst({
        where: { username, status: true },
        orderBy: { createdAt: 'asc' },
        include: {
            roles: { include: { role: true } },
            tenant: true,
        },
    });

    if (!user || !user.tenantId) return null;
    if (user.tenant && !user.tenant.status) return null;

    const check = await verifyPassword(password, user.password);
    if (!check.ok) return null;

    // Lazy rehash：舊 SHA-256 通過 → 升級為 bcrypt
    if (check.needsRehash) {
        try {
            await prisma.user.update({
                where: { id: user.id },
                data: { password: await hashPasswordAsync(password) },
            });
        } catch (err) {
            console.error('[bot/auth] lazy rehash failed:', err);
        }
    }

    // 取最高角色
    const roleCode = resolveRoleCode(user.roles.map(r => r.role.code));

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
