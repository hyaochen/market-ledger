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
        include: { roles: { include: { role: true } } },
    });

    if (!user || !user.status) return null;

    const roleCodes = user.roles.map((item) => item.role.code);
    const roleCode = resolveHighestRole(roleCodes);

    return {
        id: user.id,
        username: user.username,
        realName: user.realName,
        status: user.status,
        roleCode,
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

export function resolveRoleCode(codes: string[]): RoleCode {
    return resolveHighestRole(codes);
}
