// 清理 OperationLog：刪除 90 天以前的紀錄，避免表無限長大
// 用法：npm run prune:logs
// 也可納入排程（cron / Task Scheduler）每週跑一次

import { PrismaClient } from "@prisma/client";

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 90);

async function main() {
    const prisma = new PrismaClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    const before = await prisma.operationLog.count();
    const { count } = await prisma.operationLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
    });
    const after = await prisma.operationLog.count();

    console.log(
        `[prune-logs] retention=${RETENTION_DAYS}d cutoff=${cutoff.toISOString()} ` +
        `deleted=${count} rows. OperationLog rows: ${before} → ${after}.`,
    );

    // 回收空間（SQLite 刪除後不會自動縮檔）
    await prisma.$executeRawUnsafe("VACUUM;");
    console.log("[prune-logs] VACUUM done.");

    await prisma.$disconnect();
}

main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[prune-logs] failed:", msg);
    process.exit(1);
});
