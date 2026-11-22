/**
 * 特權操作（帳號管理、企業管理、切換企業）的稽核紀錄。
 * build* 是純函式，只組出 OperationLog 資料，方便單元測試；record* 才會寫 DB。
 *
 * 絕對不放進 details：密碼明文、密碼雜湊、session token。
 * builder 的輸入型別刻意沒有這些欄位，呼叫端也不要把整個 user 物件傳進來。
 */
import { headers } from "next/headers";
import prisma from "@/lib/prisma";
import { clientIpFromHeaders } from "@/lib/login-limiter";

export type PrivilegedOp =
    | "user.create"
    | "user.status"
    | "user.delete"
    | "user.role"
    | "user.password_reset"
    | "tenant.create"
    | "tenant.update"
    | "tenant.status"
    | "tenant.switch_in"
    | "tenant.switch_back";

export interface PrivilegedLogData {
    userId: string;
    action: "CREATE" | "UPDATE" | "DELETE" | "SWITCH";
    module: "USER" | "TENANT" | "AUTH";
    target: string;
    details: string;
    ip: string;
    status: "SUCCESS";
    tenantId: string | null;
}

interface Common {
    actorId: string;
    ip: string;
}

function make(
    c: Common,
    action: PrivilegedLogData["action"],
    module: PrivilegedLogData["module"],
    target: string,
    tenantId: string | null,
    details: Record<string, unknown>,
): PrivilegedLogData {
    return {
        userId: c.actorId,
        action,
        module,
        target,
        details: JSON.stringify(details),
        ip: c.ip,
        status: "SUCCESS",
        tenantId,
    };
}

export function buildUserCreateAudit(
    c: Common & {
        tenantId: string;
        userId: string;
        username: string;
        realName: string | null;
        departmentId: string | null;
        roleCodes: string[];
    },
) {
    return make(c, "CREATE", "USER", c.username, c.tenantId, {
        op: "user.create",
        userId: c.userId,
        before: null,
        after: { username: c.username, realName: c.realName, departmentId: c.departmentId, roleCodes: c.roleCodes, status: true },
    });
}

export function buildUserStatusAudit(
    c: Common & { tenantId: string; userId: string; username: string; before: boolean; after: boolean },
) {
    return make(c, "UPDATE", "USER", c.username, c.tenantId, {
        op: "user.status",
        userId: c.userId,
        before: { status: c.before },
        after: { status: c.after },
    });
}

export function buildUserDeleteAudit(
    c: Common & { tenantId: string; userId: string; username: string; roleCodes: string[]; status: boolean },
) {
    return make(c, "DELETE", "USER", c.username, c.tenantId, {
        op: "user.delete",
        userId: c.userId,
        before: { username: c.username, roleCodes: c.roleCodes, status: c.status },
        after: null,
    });
}

export function buildUserRoleAudit(
    c: Common & { tenantId: string; userId: string; username: string; beforeRoleCodes: string[]; afterRoleCode: string },
) {
    return make(c, "UPDATE", "USER", c.username, c.tenantId, {
        op: "user.role",
        userId: c.userId,
        before: { roleCodes: c.beforeRoleCodes },
        after: { roleCodes: [c.afterRoleCode] },
    });
}

/** 只記「誰重設了誰的密碼」，不接收任何密碼相關的值。 */
export function buildPasswordResetAudit(c: Common & { tenantId: string | null; userId: string; username: string }) {
    return make(c, "UPDATE", "USER", c.username, c.tenantId, {
        op: "user.password_reset",
        userId: c.userId,
        sessionsRevoked: true,
    });
}

export function buildTenantCreateAudit(
    c: Common & { tenantId: string; code: string; name: string; note: string | null; adminUserId: string; adminUsername: string },
) {
    return make(c, "CREATE", "TENANT", c.code, c.tenantId, {
        op: "tenant.create",
        tenantId: c.tenantId,
        before: null,
        after: { code: c.code, name: c.name, note: c.note, status: true },
        adminUserId: c.adminUserId,
        adminUsername: c.adminUsername,
    });
}

export function buildTenantUpdateAudit(
    c: Common & {
        tenantId: string;
        code: string;
        before: { name: string; note: string | null };
        after: { name: string; note: string | null };
    },
) {
    return make(c, "UPDATE", "TENANT", c.code, c.tenantId, {
        op: "tenant.update",
        tenantId: c.tenantId,
        before: c.before,
        after: c.after,
    });
}

export function buildTenantStatusAudit(
    c: Common & { tenantId: string; code: string; name: string; before: boolean; after: boolean },
) {
    return make(c, "UPDATE", "TENANT", c.code, c.tenantId, {
        op: "tenant.status",
        tenantId: c.tenantId,
        tenantName: c.name,
        before: { status: c.before },
        after: { status: c.after },
    });
}

/** direction: in = 進入企業、back = 離開企業回到超級管理後台；tenantId 都是「被進入／被離開」的那個企業。 */
export function buildTenantSwitchAudit(
    c: Common & { direction: "in" | "back"; tenantId: string; code: string; name: string },
) {
    return make(c, "SWITCH", "AUTH", c.code, c.tenantId, {
        op: c.direction === "in" ? "tenant.switch_in" : "tenant.switch_back",
        tenantId: c.tenantId,
        tenantName: c.name,
    });
}

/** 目前請求的 client IP；取不到時回 unknown。 */
export async function requestIp(): Promise<string> {
    try {
        return clientIpFromHeaders(await headers());
    } catch {
        return "unknown";
    }
}

type AuditDb = { operationLog: { create(a: { data: PrivilegedLogData }): Promise<unknown> } };

/** 寫進指定的 db / 交易；失敗會丟出（讓交易回滾）。 */
export function writePrivilegedAudit(db: AuditDb, data: PrivilegedLogData) {
    return db.operationLog.create({ data });
}

/**
 * 操作成功之後才寫的稽核：寫入失敗不影響已完成的操作，只在 log 留一行（不含任何值）。
 */
export async function recordPrivilegedAudit(data: PrivilegedLogData) {
    try {
        await writePrivilegedAudit(prisma as unknown as AuditDb, data);
    } catch (err) {
        const code = (err as { code?: string } | null)?.code ?? "";
        console.error(`[audit] failed to write privileged audit (${data.module}/${data.action}) ${code}`);
    }
}
