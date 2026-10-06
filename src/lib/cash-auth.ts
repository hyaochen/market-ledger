import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import type { CashShellUser } from "@/lib/cash-ui";

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

/**
 * 給 /cash layout 用的「不 redirect」版本（T-ML-034）。
 *
 * 為什麼另外寫一個而不是用 requireCashAuth：/cash/login 也套同一個 layout，
 * layout 若用會 redirect 的 requireCashAuth，未登入時會一直導向登入頁、無限迴圈。
 *
 * - 未登入（或沒有租戶）→ null，layout 就只渲染 children、不顯示任何導覽
 * - 攤位 fallback 規則與 requireCashAuth 一致：沒指派攤位 → 屏東攤位
 * - 只做加法：requireCashAuth / requireCashAdmin 的行為完全沒動
 */
export async function getCashUserOrNull(): Promise<CashShellUser | null> {
    const user = await getCurrentUser();
    if (!user || !user.tenantId) return null;

    const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { locationId: true },
    });
    let locationId = dbUser?.locationId ?? null;
    if (!locationId) {
        const pingtung = await prisma.location.findFirst({
            where: { tenantId: user.tenantId, name: "屏東攤位" },
            select: { id: true },
        });
        locationId = pingtung?.id ?? null;
    }

    let locationName: string | null = null;
    if (locationId) {
        const loc = await prisma.location.findUnique({
            where: { id: locationId },
            select: { name: true },
        });
        locationName = loc?.name ?? null;
    }

    return {
        displayName: user.realName || user.username,
        username: user.username,
        isAdmin: user.roleCode === "admin" || user.isSuperAdmin,
        locationName,
    };
}
