import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export type CashUser = {
    id: string;
    username: string;
    realName: string | null;
    tenantId: string;
    locationId: string | null;
    isAdmin: boolean;
    isEmployee: boolean;
    displayName: string;
};

/**
 * Cash PWA 專用 auth helper。
 * - 未登入 → redirect /cash/login
 * - 沒指派攤位 → 自動 fallback 到屏東攤位（員工帳號預期都綁屏東）
 * - 回傳 cash-friendly user payload
 */
export async function requireCashAuth(): Promise<CashUser> {
    const user = await getCurrentUser();
    if (!user || !user.tenantId) {
        redirect("/cash/login");
    }

    let locationId: string | null = null;
    const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { locationId: true },
    });
    locationId = dbUser?.locationId ?? null;

    // 沒指派攤位 → 自動 fallback 到屏東攤位
    if (!locationId) {
        const pingtung = await prisma.location.findFirst({
            where: { tenantId: user.tenantId, name: "屏東攤位" },
            select: { id: true },
        });
        locationId = pingtung?.id ?? null;
    }

    return {
        id: user.id,
        username: user.username,
        realName: user.realName,
        tenantId: user.tenantId,
        locationId,
        isAdmin: user.roleCode === "admin" || user.isSuperAdmin,
        isEmployee: user.roleCode !== "admin" && !user.isSuperAdmin,
        displayName: user.realName || user.username,
    };
}

export async function requireCashAdmin(): Promise<CashUser> {
    const user = await requireCashAuth();
    if (!user.isAdmin) {
        redirect("/cash");
    }
    return user;
}
