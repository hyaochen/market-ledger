/**
 * 現金清點的稽核紀錄內容（純函式；寫入由呼叫端走 OperationLog）。
 * 不放簽名與整份面額表：details 只放金額、人、既有紀錄 id 的新舊值。
 */

export const CASH_AUDIT_MODULE = "CASH";

export interface CashSubmitAuditInput {
    userId: string;
    tenantId: string;
    dateStr: string; // YYYY-MM-DD
    locationId: string;
    cashCountId: string;
    revenueId: string;
    revenue: { before: number | null; after: number };
    previous: null | {
        cashCountId: string;
        attendantId: string;
        salesTotal: number;
        expensesTotal: number;
        totalSales: number;
    };
    next: { attendantId: string; salesTotal: number; expensesTotal: number; totalSales: number };
}

export interface OperationLogData {
    userId: string;
    action: "CREATE" | "UPDATE";
    module: string;
    target: string;
    details: string;
    status: "SUCCESS";
    tenantId: string;
}

export function buildCashSubmitAudit(i: CashSubmitAuditInput): OperationLogData {
    const overwrite = i.previous !== null || i.revenue.before !== null;
    const details = {
        date: i.dateStr,
        locationId: i.locationId,
        cashCountId: i.cashCountId,
        revenueId: i.revenueId,
        overwrite,
        revenueAmount: { before: i.revenue.before, after: i.revenue.after },
        attendantId: { before: i.previous?.attendantId ?? null, after: i.next.attendantId },
        salesTotal: { before: i.previous?.salesTotal ?? null, after: i.next.salesTotal },
        expensesTotal: { before: i.previous?.expensesTotal ?? null, after: i.next.expensesTotal },
        totalSales: { before: i.previous?.totalSales ?? null, after: i.next.totalSales },
        previousCashCountId: i.previous?.cashCountId ?? null,
    };
    return {
        userId: i.userId,
        action: overwrite ? "UPDATE" : "CREATE",
        module: CASH_AUDIT_MODULE,
        target: `${i.dateStr} ${i.locationId}`,
        details: JSON.stringify(details),
        status: "SUCCESS",
        tenantId: i.tenantId,
    };
}

export interface EntryAuditInput {
    userId: string | null;
    tenantId: string;
    dateStr: string;
    entryId: string;
    expenseType: string;
    action: "created" | "updated";
    before: number | null;
    after: number;
    source: string; // 例如 CASH_COUNT / CASH_COUNT_AUTOFILL
    mode: string;
}

export function buildEntryAudit(i: EntryAuditInput): Record<string, unknown> {
    return {
        userId: i.userId,
        action: i.action === "created" ? "CREATE" : "UPDATE",
        module: "ENTRY",
        target: i.entryId,
        details: JSON.stringify({
            source: i.source,
            mode: i.mode,
            date: i.dateStr,
            expenseType: i.expenseType,
            amount: { before: i.before, after: i.after },
        }),
        status: "SUCCESS",
        tenantId: i.tenantId,
    };
}
