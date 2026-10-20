/**
 * 現金清點的「覆核人」姓名：每個租戶自己的設定，不寫死在程式碼。
 *
 * 來源順序：
 *   1. SystemConfig（key = cash.supervisorName，tenantId = 該租戶）
 *   2. 環境變數 CASH_SUPERVISOR_NAMES（`租戶代碼=姓名`，多個用逗號分隔；真名放 .env 不進 repo）
 *   3. 該租戶第一位（建立時間最早）有填 realName 的啟用中 admin
 *   4. 都沒有 -> 空字串（畫面顯示「未設定」，不會阻擋清點）
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

/** 純函式：從 CASH_SUPERVISOR_NAMES 取出某租戶代碼的姓名（代碼不分大小寫）。 */
export function supervisorNameFromEnv(raw: string | undefined, tenantCode: string | null | undefined): string {
    if (!raw || !tenantCode) return "";
    const want = tenantCode.trim().toLowerCase();
    for (const pair of raw.split(",")) {
        const i = pair.indexOf("=");
        if (i < 0) continue;
        if (pair.slice(0, i).trim().toLowerCase() === want) return pair.slice(i + 1).trim();
    }
    return "";
}

export async function getCashSupervisorName(tenantId: string): Promise<string> {
    const cfg = await prisma.systemConfig.findFirst({
        where: { key: SUPERVISOR_CONFIG_KEY, tenantId },
        select: { value: true },
    });
    if (cfg?.value?.trim()) return cfg.value.trim();
    if (process.env.CASH_SUPERVISOR_NAMES) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { code: true } });
        const fromEnv = supervisorNameFromEnv(process.env.CASH_SUPERVISOR_NAMES, tenant?.code);
        if (fromEnv) return fromEnv;
    }
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
