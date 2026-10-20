// POS 資料的存取規則（allowlist）：
//   - 只有環境變數 POS_TENANT_CODES（逗號分隔的租戶代碼，不分大小寫）列出的租戶可以看。
//   - 沒設或是空字串 = 沒有任何租戶能看（預設拒絕；忘了設就是關著，不會變成全開）。
//
// 為什麼是 allowlist：POS 資料是單一全域的 yjc.db，沒有租戶隔離；以前「非 demo 就能看」，
// 任何新建的租戶都會讀到洪記軒的營業資料。
// 用「租戶」擋、不用角色擋：同租戶內 admin / write / read 都能看。
// 沒有租戶脈絡的帳號（例如還沒選企業的 super admin）也不放行。

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/** 解析 POS_TENANT_CODES；每次呼叫都重讀環境變數（方便測試，成本可忽略）。 */
export function posTenantAllowlist(raw: string | undefined = process.env.POS_TENANT_CODES): string[] {
    if (!raw) return [];
    return raw
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0);
}

export function canViewPos(
    user: { tenantId: string | null; tenantCode: string | null } | null,
    allowlist: string[] = posTenantAllowlist(),
): boolean {
    if (!user || !user.tenantId || !user.tenantCode) return false;
    return allowlist.includes(user.tenantCode.trim().toLowerCase());
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
