/**
 * 現金清點的「覆核人」姓名：每個租戶自己的設定，不寫死在程式碼。
 *
 * 來源順序：
 *   1. SystemConfig（key = cash.supervisorName，tenantId = 該租戶）
 *   2. 該租戶第一位（建立時間最早）有填 realName 的啟用中 admin
 *   3. 都沒有 -> 空字串（畫面顯示「未設定」，不會阻擋清點）
 */
import prisma from "@/lib/prisma";

export const SUPERVISOR_CONFIG_KEY = "cash.supervisorName";
export const SUPERVISOR_PLACEHOLDER = "未設定";

/** 純函式：依來源順序挑名字。 */
export function pickSupervisorName(configValue: string | null | undefined, adminRealNames: Array<string | null | undefined>): string {
    const fromConfig = (configValue ?? "").trim();
    if (fromConfig) return fromConfig;
    for (const n of adminRealNames) {
        const t = (n ?? "").trim();
        if (t) return t;
    }
    return "";
}

export async function getCashSupervisorName(tenantId: string): Promise<string> {
    const cfg = await prisma.systemConfig.findFirst({
        where: { key: SUPERVISOR_CONFIG_KEY, tenantId },
        select: { value: true },
    });
    if (cfg?.value?.trim()) return cfg.value.trim();
    const admins = await prisma.user.findMany({
        where: {
            tenantId,
            status: true,
            isSuperAdmin: false,
            realName: { not: null },
            roles: { some: { role: { code: "admin" } } },
        },
        orderBy: { createdAt: "asc" },
        select: { realName: true },
        take: 5,
    });
    return pickSupervisorName(cfg?.value, admins.map((a) => a.realName));
}
