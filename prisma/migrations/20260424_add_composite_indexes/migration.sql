-- Add composite indexes for common query patterns
-- Entry: reports filter by (tenantId, date range, type)
-- Revenue: monthly/daily sums by (tenantId, date)

-- CreateIndex
CREATE INDEX "Entry_tenantId_date_type_idx" ON "Entry"("tenantId", "date", "type");

-- CreateIndex
CREATE INDEX "Revenue_tenantId_date_idx" ON "Revenue"("tenantId", "date");
