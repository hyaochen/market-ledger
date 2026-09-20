-- T-ML-033 — Telegram bot 訊息 log（原始訊息 + 解析結果 + 最終結果），供離線評測用
-- 注意：本專案實際部署走 `npx prisma db push`（見 docker-start.sh），不是
-- `prisma migrate deploy`；這份檔案跟既有三份 migrations 一樣，只是把 schema
-- 變更的歷史記錄下來，方便日後回溯，不是自動套用的來源。

-- CreateTable
CREATE TABLE "BotMessageLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "tenantId" TEXT,
    "chatId" TEXT NOT NULL,
    "messageId" INTEGER,
    "telegramUserId" TEXT,
    "text" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "llmProvider" TEXT,
    "parsedJson" TEXT,
    "outcome" TEXT,
    "finalJson" TEXT,
    "refMessageId" INTEGER
);

-- Indexes
CREATE INDEX "BotMessageLog_chatId_createdAt_idx" ON "BotMessageLog"("chatId", "createdAt");
CREATE INDEX "BotMessageLog_chatId_messageId_idx" ON "BotMessageLog"("chatId", "messageId");
