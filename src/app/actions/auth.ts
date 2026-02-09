'use server';

import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";
import { signSession } from "@/lib/session";
import { resolveRoleCode } from "@/lib/auth";

export async function login(formData: FormData) {
    const username = (formData.get("username") as string | null)?.trim();
    const password = formData.get("password") as string | null;

    if (!username || !password) {
        return { success: false, message: "請輸入帳號與密碼" };
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
        return { success: false, message: "帳號不存在或已停用" };
    }

    const hashedPassword = createHash("sha256").update(password).digest("hex");
    if (user.password !== hashedPassword) {
        return { success: false, message: "密碼錯誤" };
    }

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
        sameSite: "lax",
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
        sameSite: "lax",
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
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return { success: true };
}

export async function logout() {
    const cookieStore = await cookies();
    cookieStore.set("session", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
    return { success: true };
}
