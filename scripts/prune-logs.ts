// 清理 OperationLog / BotMessageLog：刪除保留期限以前的紀錄，避免表無限長大
// 用法：npm run prune:logs
// 也可納入排程（cron / Task Scheduler）每週跑一次

import { PrismaClient } from "@prisma/client";

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS ?? 90);
// T-ML-033：BotMessageLog 是離線評測用的 labeled set，保留期比一般操作日誌長很多
// （365 天），跟 OperationLog 分開設定，避免評測資料被 90 天規則提早清掉。
const BOT_MESSAGE_LOG_RETENTION_DAYS = Number(process.env.BOT_MESSAGE_LOG_RETENTION_DAYS ?? 365);

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

    const botMsgCutoff = new Date();
    botMsgCutoff.setDate(botMsgCutoff.getDate() - BOT_MESSAGE_LOG_RETENTION_DAYS);

    const botMsgBefore = await prisma.botMessageLog.count();
    const { count: botMsgDeleted } = await prisma.botMessageLog.deleteMany({
        where: { createdAt: { lt: botMsgCutoff } },
    });
    const botMsgAfter = await prisma.botMessageLog.count();

    console.log(
        `[prune-logs] retention=${BOT_MESSAGE_LOG_RETENTION_DAYS}d cutoff=${botMsgCutoff.toISOString()} ` +
        `deleted=${botMsgDeleted} rows. BotMessageLog rows: ${botMsgBefore} → ${botMsgAfter}.`,
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
