'use server';

import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { signSession } from "@/lib/session";
import { resolveRoleCode } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";

// Rate limiting
const loginAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// 統一最小回應時間，降低「帳號是否存在」的 timing leak
const MIN_RESPONSE_MS = 300;

function recordFailure(username: string) {
    const r = loginAttempts.get(username) ?? { count: 0, lastAttempt: 0 };
    r.count++;
    r.lastAttempt = Date.now();
    loginAttempts.set(username, r);
}

async function delayUntil(startedAt: number, minMs: number) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
    }
}

export async function login(formData: FormData) {
    const t0 = Date.now();
    const username = (formData.get("username") as string | null)?.trim();
    const password = formData.get("password") as string | null;

    if (!username || !password) {
        return { success: false, message: "請輸入帳號與密碼" };
    }

    // Rate limit check（用 username 當 key；帳號不存在也算，防列舉）
    const record = loginAttempts.get(username);
    if (record && record.count >= MAX_ATTEMPTS && Date.now() - record.lastAttempt < LOCKOUT_MS) {
        const remaining = Math.ceil((LOCKOUT_MS - (Date.now() - record.lastAttempt)) / 60000);
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: `登入嘗試過多，請 ${remaining} 分鐘後再試` };
    }

    // 查詢用戶（跨租戶搜尋，同一 username 在不同租戶中可能存在）
    const user = await prisma.user.findFirst({
        where: {
            username,
            status: true,
            OR: [
                { isSuperAdmin: true },
                { tenant: { status: true } },
            ],
        },
        include: { roles: { include: { role: true } }, tenant: true },
    });

    if (!user) {
        recordFailure(username);
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: "帳號或密碼錯誤" };
    }

    const check = verifyPassword(password, user.password);
    if (!check.ok) {
        recordFailure(username);
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: "帳號或密碼錯誤" };
    }

    // Lazy rehash：舊 SHA-256 驗證通過 → 升級為 bcrypt 存回
    if (check.needsRehash) {
        try {
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashPassword(password) },
            });
        } catch (err) {
            console.error('[auth] lazy rehash failed:', err);
        }
    }

    // Clear rate limit on success
    loginAttempts.delete(username);

    const roleCodes = user.roles.map((item) => item.role.code);
    const roleCode = resolveRoleCode(roleCodes);

    const token = signSession({
        userId: user.id,
        tenantId: user.tenantId,
        isSuperAdmin: user.isSuperAdmin,
        issuedAt: Date.now(),
    });

    const cookieStore = await cookies();
    cookieStore.set("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    // 記錄登入日誌
    await prisma.operationLog.create({
        data: {
            userId: user.id,
            action: 'LOGIN',
            module: 'SYSTEM',
            target: user.username,
            details: JSON.stringify({ isSuperAdmin: user.isSuperAdmin }),
            status: 'SUCCESS',
            tenantId: user.tenantId,
        },
    });

    return {
        success: true,
        roleCode,
        isSuperAdmin: user.isSuperAdmin,
    };
}

/** 超級管理者切換到指定企業 */
export async function switchToTenant(tenantId: string) {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
        return { success: false, error: "權限不足" };
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
        return { success: false, error: "企業不存在" };
    }

    const token = signSession({
        userId: user.id,
        tenantId: tenant.id,
        isSuperAdmin: true,
        issuedAt: Date.now(),
    });

    const cookieStore = await cookies();
    cookieStore.set("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return { success: true };
}

/** 超級管理者返回超級管理後台 */
export async function switchBackToSuperAdmin() {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
        return { success: false, error: "權限不足" };
    }

    const token = signSession({
        userId: user.id,
        tenantId: null,
        isSuperAdmin: true,
        issuedAt: Date.now(),
    });

    const cookieStore = await cookies();
    cookieStore.set("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return { success: true };
}

export async function logout() {
    const cookieStore = await cookies();
    cookieStore.set("session", "", {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
}
