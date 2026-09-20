// T-ML-033 — 匯出 BotMessageLog 成 JSONL，供離線評測解析器與 Jev 意圖閘門用。
//
// 用法（容器內執行——DB 只在 named volume 裡，host 端連不到）：
//   docker exec market-ledger-bot npx tsx scripts/export-bot-message-log.ts --since 2026-09-20 > out.jsonl
//
// 參數：
//   --since YYYY-MM-DD   必填，只匯出這天 00:00（含，本機時區）之後建立的紀錄
//   --out <path>         選填，寫進檔案而非印到 stdout（預設印到 stdout，方便 shell
//                         重導向；狀態訊息一律走 stderr，不會混進輸出檔）
//
// 每一行是一筆 JSON：createdAt/text/route/llmProvider/parsedJson/outcome/finalJson。
// 刻意不含 telegramUserId / chatId / messageId ——這份匯出檔是要離開容器、離開資料庫
// 去做離線評測用的，不需要也不該帶使用者身分欄位（資料只留本機 DB 的前提不因為匯出
// 成檔案就破功）。

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv: string[]): { since: string; out: string | null } {
    let since: string | null = null;
    let out: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--since") {
            since = argv[++i] ?? null;
        } else if (argv[i] === "--out") {
            out = argv[++i] ?? null;
        }
    }
    if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        console.error("[export-bot-message-log] 缺少或格式錯誤的 --since YYYY-MM-DD");
        process.exit(1);
    }
    return { since, out };
}

async function main() {
    const { since, out } = parseArgs(process.argv.slice(2));
    const sinceDate = new Date(`${since}T00:00:00`);
    if (Number.isNaN(sinceDate.getTime())) {
        console.error(`[export-bot-message-log] 無法解析日期：${since}`);
        process.exit(1);
    }

    const prisma = new PrismaClient();
    const rows = await prisma.botMessageLog.findMany({
        where: { createdAt: { gte: sinceDate } },
        orderBy: { createdAt: "asc" },
        select: {
            createdAt: true,
            text: true,
            route: true,
            llmProvider: true,
            parsedJson: true,
            outcome: true,
            finalJson: true,
        },
    });

    const lines = rows.map((r) => JSON.stringify({
        createdAt: r.createdAt.toISOString(),
        text: r.text,
        route: r.route,
        llmProvider: r.llmProvider,
        parsedJson: r.parsedJson,
        outcome: r.outcome,
        finalJson: r.finalJson,
    }));

    if (out) {
        fs.writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""));
        console.error(`[export-bot-message-log] wrote ${lines.length} rows to ${out}`);
    } else {
        for (const line of lines) {
            process.stdout.write(line + "\n");
        }
        console.error(`[export-bot-message-log] wrote ${lines.length} rows to stdout`);
    }

    await prisma.$disconnect();
}

main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[export-bot-message-log] failed:", msg);
    process.exit(1);
});
