/**
 * submitCashCount 的交易內寫入邏輯（Revenue upsert + CashCount upsert + checklist + 稽核）。
 * 從 server action 抽出，讓測試能用假 tx 驗證；tx 只用到下面這個窄介面。
 */
import { appendRevenueNote } from "@/lib/cash-validate";
import { buildCashSubmitAudit } from "@/lib/cash-audit";

type Row = Record<string, unknown>;

export interface CashTx {
    cashCount: {
        findFirst(a: { where: Row; select?: Row }): Promise<{ id: string; revenueId: string | null; attendantId: string; salesTotal: number; expensesTotal: number; totalSales: number } | null>;
        update(a: { where: { id: string }; data: Row }): Promise<{ id: string }>;
        create(a: { data: Row }): Promise<{ id: string }>;
    };
    revenue: {
        findFirst(a: { where: Row }): Promise<{ id: string; amount: number; note: string | null } | null>;
        update(a: { where: { id: string }; data: Row }): Promise<{ id: string }>;
        create(a: { data: Row }): Promise<{ id: string }>;
    };
    cashCountChecklistDone: {
        deleteMany(a: { where: Row }): Promise<unknown>;
        create(a: { data: Row }): Promise<unknown>;
    };
    operationLog: { create(a: { data: Row }): Promise<unknown> };
}

export interface PersistCashCountParams {
    user: { id: string; username: string; tenantId: string };
    locationId: string;
    date: Date;
    dateStr: string;
    supervisorName: string | null;
    cashBox: { map: Record<string, number>; total: number };
    reserve: { map: Record<string, number>; total: number };
    sales: { map: Record<string, number>; total: number };
    expenses: unknown[];
    expensesTotal: number;
    totalSales: number;
    signatureDataUrl: string;
    note: string;
    checklistDone: Array<{ id: string; done: boolean }>;
}

export async function persistCashCount(tx: CashTx, p: PersistCashCountParams): Promise<{ cashCountId: string; revenueId: string }> {
    const { user } = p;
    const existingCount = await tx.cashCount.findFirst({
        where: { date: p.date, locationId: p.locationId, tenantId: user.tenantId },
        select: { id: true, revenueId: true, attendantId: true, salesTotal: true, expensesTotal: true, totalSales: true },
    });
    const existingRevenue = await tx.revenue.findFirst({
        where: { date: p.date, locationId: p.locationId, tenantId: user.tenantId },
    });

    let revenue: { id: string };
    if (existingRevenue) {
        revenue = await tx.revenue.update({
            where: { id: existingRevenue.id },
            data: {
                amount: p.totalSales,
                isDayOff: false,
                note: appendRevenueNote(existingRevenue.note, `cash 清點修正 (${user.username})`),
            },
        });
    } else {
        revenue = await tx.revenue.create({
            data: {
                date: p.date,
                locationId: p.locationId,
                tenantId: user.tenantId,
                amount: p.totalSales,
                isDayOff: false,
                note: `來自 cash 清點 (${user.username})`,
            },
        });
    }

    const cashCountData = {
        date: p.date,
        tenantId: user.tenantId,
        locationId: p.locationId,
        attendantId: user.id,
        supervisorName: p.supervisorName,
        cashBoxJson: JSON.stringify(p.cashBox.map),
        cashBoxTotal: p.cashBox.total,
        reserveJson: JSON.stringify(p.reserve.map),
        reserveTotal: p.reserve.total,
        salesJson: JSON.stringify(p.sales.map),
        salesTotal: p.sales.total,
        expensesJson: JSON.stringify(p.expenses),
        expensesTotal: p.expensesTotal,
        totalSales: p.totalSales,
        signatureDataUrl: p.signatureDataUrl,
        supervisorSignDataUrl: p.signatureDataUrl, // auto-sync per spec
        handoverTime: new Date(),
        revenueId: revenue.id,
        note: p.note || null,
    };

    let cashCount: { id: string };
    if (existingCount) {
        cashCount = await tx.cashCount.update({ where: { id: existingCount.id }, data: cashCountData });
        await tx.cashCountChecklistDone.deleteMany({ where: { cashCountId: existingCount.id } });
    } else {
        cashCount = await tx.cashCount.create({ data: cashCountData });
    }

    for (const c of p.checklistDone) {
        await tx.cashCountChecklistDone.create({
            data: { cashCountId: cashCount.id, checklistItemId: c.id, done: c.done },
        });
    }

    // 稽核：與上面的寫入同一個交易，寫不進去整筆回滾
    await tx.operationLog.create({
        data: buildCashSubmitAudit({
            userId: user.id,
            tenantId: user.tenantId,
            dateStr: p.dateStr,
            locationId: p.locationId,
            cashCountId: cashCount.id,
            revenueId: revenue.id,
            revenue: { before: existingRevenue ? existingRevenue.amount : null, after: p.totalSales },
            previous: existingCount
                ? {
                      cashCountId: existingCount.id,
                      attendantId: existingCount.attendantId,
                      salesTotal: existingCount.salesTotal,
                      expensesTotal: existingCount.expensesTotal,
                      totalSales: existingCount.totalSales,
                  }
                : null,
            next: { attendantId: user.id, salesTotal: p.sales.total, expensesTotal: p.expensesTotal, totalSales: p.totalSales },
        }) as unknown as Row,
    });

    return { cashCountId: cashCount.id, revenueId: revenue.id };
}
