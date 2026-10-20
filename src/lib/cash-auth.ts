import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser, getRoleRank, type RoleCode } from "@/lib/auth";
import type { CashShellUser } from "@/lib/cash-ui";

export type CashUser = {
    id: string;
    username: string;
    realName: string | null;
    tenantId: string;
    locationId: string | null;
    isAdmin: boolean;
    /** 清點員：角色剛好是 write（read 角色不算員工，也不能寫入） */
    isEmployee: boolean;
    /** 可以寫入清點資料（write 以上；super admin 進入租戶時視為 admin） */
    canWrite: boolean;
    displayName: string;
};

// 部分員工 / 管理者帳號沒有綁定攤位（User.locationId 為空）。這是整個 cash 站「唯一」的攤位
// fallback：沒綁攤位就用這個名稱的攤位。要改預設攤位只改這一個常數。
const DEFAULT_CASH_LOCATION_NAME = "屏東攤位";

/** 解析使用者的攤位：自己綁的優先，沒綁才 fallback 到預設攤位（同租戶內）。 */
async function resolveCashLocationId(userId: string, tenantId: string): Promise<string | null> {
    const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { locationId: true },
    });
    if (dbUser?.locationId) return dbUser.locationId;
    const fallback = await prisma.location.findFirst({
        where: { tenantId, name: DEFAULT_CASH_LOCATION_NAME },
        select: { id: true },
    });
    return fallback?.id ?? null;
}

type RoleView = { roleCode: RoleCode; isSuperAdmin: boolean };

export function cashRoleFlags(user: RoleView) {
    const isAdmin = user.roleCode === "admin" || user.isSuperAdmin;
    const canWrite = isAdmin || getRoleRank(user.roleCode) >= getRoleRank("write");
    return {
        isAdmin,
        canWrite,
        isEmployee: !isAdmin && user.roleCode === "write",
    };
}

/**
 * Cash PWA 專用 auth helper。
 * - 未登入 → redirect /cash/login
 * - 沒指派攤位 → fallback 到預設攤位（見 resolveCashLocationId）
 * - 回傳 cash-friendly user payload（canWrite 為 false 的帳號只能看，不能寫入）
 */
export async function requireCashAuth(): Promise<CashUser> {
    const user = await getCurrentUser();
    if (!user || !user.tenantId) {
        redirect("/cash/login");
    }

    const locationId = await resolveCashLocationId(user.id, user.tenantId);
    const flags = cashRoleFlags(user);

    return {
        id: user.id,
        username: user.username,
        realName: user.realName,
        tenantId: user.tenantId,
        locationId,
        ...flags,
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
 * - 攤位 fallback 規則與 requireCashAuth 一致（同一個 resolveCashLocationId）
 */
export async function getCashUserOrNull(): Promise<CashShellUser | null> {
    const user = await getCurrentUser();
    if (!user || !user.tenantId) return null;

    const locationId = await resolveCashLocationId(user.id, user.tenantId);

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
        isAdmin: cashRoleFlags(user).isAdmin,
        locationName,
    };
}
