import prisma from "@/lib/prisma";

// 伺服器端 session 撤銷，不動 schema：
//   * 密碼重設 → session 內的 pwv（密碼指紋）對不上，自動失效（見 session.ts passwordFingerprint）
//   * 登出 → 在 SystemConfig 寫 `sessions_valid_after:<userId>` = 現在時間，
//     issuedAt 早於這個時間的 session 一律視為已撤銷（該使用者在所有裝置都需重新登入）。
// SystemConfig 的 @@unique([key, tenantId]) 在 tenantId 為 null 時 SQLite 不會強制唯一，所以用 findFirst + update/create。

const keyOf = (userId: string) => `sessions_valid_after:${userId}`;

export async function getSessionsValidAfter(userId: string): Promise<number> {
    const row = await prisma.systemConfig.findFirst({
        where: { key: keyOf(userId), tenantId: null },
        select: { value: true },
    });
    const n = row ? Number(row.value) : 0;
    return Number.isFinite(n) ? n : 0;
}

export async function revokeUserSessions(userId: string, at: number = Date.now()) {
    const key = keyOf(userId);
    const existing = await prisma.systemConfig.findFirst({ where: { key, tenantId: null }, select: { id: true } });
    if (existing) {
        await prisma.systemConfig.update({ where: { id: existing.id }, data: { value: String(at) } });
    } else {
        await prisma.systemConfig.create({ data: { key, value: String(at), tenantId: null } });
    }
}
