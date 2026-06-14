-- T-ML-002 — CashCount PWA 模組（員工現金清點）

-- CreateTable: 每日清點主表
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "supervisorName" TEXT NOT NULL DEFAULT '洪怜俼',
    "cashBoxJson" TEXT NOT NULL,
    "cashBoxTotal" REAL NOT NULL,
    "reserveJson" TEXT NOT NULL,
    "reserveTotal" REAL NOT NULL,
    "salesJson" TEXT NOT NULL,
    "salesTotal" REAL NOT NULL,
    "expensesJson" TEXT NOT NULL,
    "expensesTotal" REAL NOT NULL,
    "totalSales" REAL NOT NULL,
    "signatureDataUrl" TEXT NOT NULL,
    "supervisorSignDataUrl" TEXT,
    "handoverTime" DATETIME NOT NULL,
    "revenueId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashCount_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashCount_revenueId_fkey" FOREIGN KEY ("revenueId") REFERENCES "Revenue" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable: 動作清單
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable: 清點 ↔ 動作勾選
CREATE TABLE "CashCountChecklistDone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cashCountId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CashCountChecklistDone_cashCountId_fkey" FOREIGN KEY ("cashCountId") REFERENCES "CashCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CashCountChecklistDone_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "ChecklistItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes
CREATE UNIQUE INDEX "CashCount_date_locationId_tenantId_key" ON "CashCount"("date", "locationId", "tenantId");
CREATE INDEX "CashCount_date_idx" ON "CashCount"("date");
CREATE INDEX "CashCount_attendantId_idx" ON "CashCount"("attendantId");
CREATE INDEX "CashCount_tenantId_idx" ON "CashCount"("tenantId");
CREATE INDEX "CashCount_tenantId_date_idx" ON "CashCount"("tenantId", "date");

CREATE INDEX "ChecklistItem_tenantId_idx" ON "ChecklistItem"("tenantId");

CREATE UNIQUE INDEX "CashCountChecklistDone_cashCountId_checklistItemId_key" ON "CashCountChecklistDone"("cashCountId", "checklistItemId");
CREATE INDEX "CashCountChecklistDone_checklistItemId_idx" ON "CashCountChecklistDone"("checklistItemId");
