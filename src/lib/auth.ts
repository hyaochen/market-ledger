import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { verifySession, type SessionPayload } from "@/lib/session";

export type RoleCode = "read" | "write" | "admin";

const ROLE_RANK: Record<RoleCode, number> = {
    read: 1,
    write: 2,
    admin: 3,
};

type CurrentUser = {
    id: string;
    username: string;
    realName: string | null;
    status: boolean;
    roleCode: RoleCode;
    tenantId: string | null;
    tenantName: string | null;
    isSuperAdmin: boolean;
};

function resolveHighestRole(codes: string[]): RoleCode {
    let highest: RoleCode = "read";
    codes.forEach((code) => {
        if (code === "admin") highest = "admin";
        else if (code === "write" && highest === "read") highest = "write";
    });
    return highest;
}

export function getRoleRank(code: RoleCode) {
    return ROLE_RANK[code] ?? 0;
}

export async function getSessionPayload(): Promise<SessionPayload | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get("session")?.value;
    return verifySession(token);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
    const payload = await getSessionPayload();
    if (!payload) return null;

    const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { roles: { include: { role: true } }, tenant: true },
    });

    if (!user || !user.status) return null;

    // 非 super admin 時，檢查租戶是否仍然啟用
    if (!user.isSuperAdmin && user.tenant && !user.tenant.status) return null;

    const roleCodes = user.roles.map((item) => item.role.code);
    let roleCode = resolveHighestRole(roleCodes);

    // 超級管理者進入企業時，用 session 中的 tenantId，並給予 admin 權限
    let tenantId = user.tenantId;
    let tenantName = user.tenant?.name ?? null;
    if (user.isSuperAdmin && payload.tenantId) {
        tenantId = payload.tenantId;
        roleCode = "admin";
        const tenant = await prisma.tenant.findUnique({
            where: { id: payload.tenantId },
            select: { name: true },
        });
        tenantName = tenant?.name ?? null;
    }

    return {
        id: user.id,
        username: user.username,
        realName: user.realName,
        status: user.status,
        roleCode,
        tenantId,
        tenantName,
        isSuperAdmin: user.isSuperAdmin,
    };
}

export async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    return user;
}

export async function requireRole(minRole: RoleCode) {
    const user = await requireAuth();
    if (getRoleRank(user.roleCode) < getRoleRank(minRole)) {
        redirect("/");
    }
    return user;
}

export async function ensureRole(minRole: RoleCode) {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "請先登入" } as const;
    if (getRoleRank(user.roleCode) < getRoleRank(minRole)) {
        return { ok: false, error: "權限不足" } as const;
    }
    return { ok: true, user } as const;
}

/** 取得目前使用者的 tenantId，super admin 呼叫會 throw */
export async function getTenantId(): Promise<string> {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (!user.tenantId) {
        throw new Error("Super admin 沒有 tenant context");
    }
    return user.tenantId;
}

export function resolveRoleCode(codes: string[]): RoleCode {
    return resolveHighestRole(codes);
}
