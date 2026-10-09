// POS 資料的存取規則（owner 決定）：
//   - 真實租戶（洪記軒）的所有登入者都能看：admin、write 員工、viewer 皆可
//   - 示範（demo）租戶的任何帳號一律不能看（預設的 viewer/viewer123 屬於它）
//
// 用「租戶」擋、不用角色擋：將來真實租戶也可能有 viewer，用角色擋會誤傷。
// demo 租戶靠 Tenant.code 辨識（schema 沒有 demo 旗標；code 有 unique 約束，穩定）。
// 沒有租戶脈絡的帳號（例如還沒選企業的 super admin）也不放行。

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const DEMO_TENANT_CODES: readonly string[] = ["demo"];

export function canViewPos(user: { tenantId: string | null; tenantCode: string | null } | null): boolean {
    if (!user || !user.tenantId || !user.tenantCode) return false;
    return !DEMO_TENANT_CODES.includes(user.tenantCode.toLowerCase());
}

/** 頁面／layout 用：沒登入導去登入，沒權限導回首頁。 */
export async function requirePosAccess() {
    const user = await getCurrentUser();
    if (!user) redirect("/login");
    if (!canViewPos(user)) redirect("/");
    return user;
}

/** server action / route handler 用：不 redirect，回結果。 */
export async function ensurePosAccess() {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "請先登入" } as const;
    if (!canViewPos(user)) return { ok: false, error: "權限不足" } as const;
    return { ok: true, user } as const;
}
