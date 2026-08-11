// T-ML-030 範圍 C（Bug 1）— 容器內產生 dev.db 的靜態快照（SQLite VACUUM INTO）。
//
// 只能在容器內執行（DATABASE_URL 指向 /app/data/dev.db，跟 web/bot 用同一個 Prisma
// client 設定）。VACUUM INTO 是 SQLite 官方 backup API，WAL 模式下能拿到一致快照，
// T-ML-027/028/029 的 backfill 腳本已驗證這條路在本專案可行。
//
// 輸出路徑刻意由呼叫端（host 的 scripts/backup-db.ts）指定成容器自己檔案系統下的
// 路徑（例如 /tmp/xxx.db），而不是 /app/data/ 下 —— /app/data 是 Windows bind mount，
// 2026-08-11 事故的根因就是「host 端 process 開過 bind mount 上的 dev.db 之後，容器
// 內已開啟的 handle 變 stale」。輸出寫到 /tmp（容器自己的可寫層，不經過 Windows 檔案
// 系統轉譯層）完全避開這個風險；host 端事後用 `docker cp` 把已經是靜態檔案的快照
// 搬出來，全程不需要 host process 碰 live dev.db 或它所在的 bind mount。
//
// 執行方式（host 端 backup-db.ts 會自動呼叫，不需要手動跑）：
//   docker exec market-ledger-bot npx tsx scripts/backup-snapshot.ts /tmp/<檔名>.db

import fs from "node:fs";
import prisma from "../src/lib/prisma";

async function main() {
    const outputPath = process.argv[2];
    if (!outputPath) {
        console.error("[backup-snapshot] missing output path argument");
        process.exitCode = 1;
        return;
    }
    if (!outputPath.startsWith("/tmp/")) {
        // 安全網：避免不小心傳進 /app/data 底下的路徑，重蹈直接碰 bind mount 的覆轍
        console.error(`[backup-snapshot] refusing to write outside /tmp: ${outputPath}`);
        process.exitCode = 1;
        return;
    }
    if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath); // VACUUM INTO 要求目的檔案不可預先存在
    }

    await prisma.$executeRawUnsafe(`VACUUM INTO '${outputPath}'`);

    const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
    console.log(`[backup-snapshot] wrote ${outputPath} (${sizeKB} KB)`);
}

main()
    .catch((err) => {
        console.error("[backup-snapshot] FATAL:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
