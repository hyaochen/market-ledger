'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { parseLocalDate } from '@/lib/date';
import { ensureRole, getTenantId } from '@/lib/auth';
import {
    previewFixedExpenses,
    applyFixedExpenses,
    stallForLocation,
    realEntryDb,
    type FixedExpenseLine,
    type FixedExpensePreview,
} from '@/lib/fixedExpenseAutofill';

/**
 * 給 RevenueForm 用：日期/地點一變動就呼叫，回傳「將自動帶入」的預覽（可能為
 * null = 這個地點/租戶不適用固定支出功能）。純查詢，不寫入。
 */
export async function getFixedExpensePreview(date: string, locationId: string): Promise<FixedExpensePreview | null> {
    const auth = await ensureRole('write');
    if (!auth.ok) return null;
    const tenantId = await getTenantId();
    const targetDate = parseLocalDate(date) ?? new Date();
    return previewFixedExpenses(tenantId, targetDate, locationId);
}

export async function recordRevenue(
    date: string,
    locationId: string,
    amount: number,
    isDayOff: boolean,
    fixedExpenses?: FixedExpenseLine[]
) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // Server-side 雙保險：沒勾休假但金額 <= 0 → 擋下，避免「漏記休假」變成髒資料
        if (!isDayOff && (!Number.isFinite(amount) || amount <= 0)) {
            return { success: false, error: '若是休假請勾選「今日休假」；若有營業請填正確金額。' };
        }

        const targetDate = parseLocalDate(date) ?? new Date();

        // 使用 upsert: 如果存在則更新，不存在則新增
        await prisma.revenue.upsert({
            where: {
                date_locationId_tenantId: {
                    date: targetDate,
                    locationId: locationId,
                    tenantId,
                }
            },
            update: {
                amount: isDayOff ? 0 : amount,
                isDayOff: isDayOff,
                updatedAt: new Date()
            },
            create: {
                date: targetDate,
                locationId: locationId,
                amount: isDayOff ? 0 : amount,
                isDayOff: isDayOff,
                tenantId,
            }
        });

        // T-ML-027 範圍 A：自動帶固定支出（清潔費+洗攤）。休假日不帶；items 由前端
        // 表單的預覽區塊決定（使用者可取消勾選/改金額），這裡完全信任傳進來的數字，
        // 冪等由 applyFixedExpenses 內部的 upsertExpenseEntry('skip-if-exists') 保證。
        let fixedExpenseResult: { created: FixedExpenseLine[]; skipped: FixedExpenseLine[] } | null = null;
        if (!isDayOff && fixedExpenses && fixedExpenses.length > 0) {
            const stall = await stallForLocation(tenantId, locationId);
            if (stall) {
                const applied = await applyFixedExpenses(realEntryDb, tenantId, targetDate, stall, auth.user.id, fixedExpenses);
                fixedExpenseResult = { created: applied.created, skipped: applied.skipped };
            }
        }

        revalidatePath('/revenue');
        revalidatePath('/');
        return { success: true, fixedExpenseResult };
    } catch (error) {
        console.error('Record Revenue Error:', error);
        return { success: false, error: '儲存失敗' };
    }
}

export async function getRevenueByDate(date: string) {
    const tenantId = await getTenantId();
    const targetDate = parseLocalDate(date) ?? new Date();

    const records = await prisma.revenue.findMany({
        where: {
            tenantId,
            date: targetDate
        },
        include: {
            location: true
        }
    });

    return records;
}

export async function updateRevenue(id: string, formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const user = auth.user;
        const tenantId = await getTenantId();

        const amount = Number.parseFloat(formData.get('amount') as string);
        const isDayOff = formData.get('isDayOff') === 'on';
        const dateInput = formData.get('date') as string | null;
        const date = parseLocalDate(dateInput) ?? new Date();

        if (!Number.isFinite(amount) || amount < 0) {
            return { success: false, error: '請填寫正確金額' };
        }

        // 驗證所有權
        const current = await prisma.revenue.findFirst({ where: { id, tenantId } });
        if (!current) {
            return { success: false, error: '找不到營收記錄' };
        }

        const currentDateKey = current.date.toISOString().slice(0, 10);
        const inputDateKey = dateInput || currentDateKey;
        const targetDate = inputDateKey === currentDateKey ? current.date : date;

        const conflict = await prisma.revenue.findFirst({
            where: {
                date: targetDate,
                locationId: current.locationId,
                tenantId,
                NOT: { id },
            },
        });
        if (conflict) {
            return { success: false, error: '該日期已存在營收記錄，請改用編輯原紀錄或先刪除' };
        }

        await prisma.revenue.update({
            where: { id },
            data: {
                date: targetDate,
                amount: isDayOff ? 0 : amount,
                isDayOff,
            },
        });

        await prisma.operationLog.create({
            data: {
                action: 'UPDATE',
                module: 'REVENUE',
                userId: user.id,
                target: id,
                details: JSON.stringify({ amount, isDayOff, date: targetDate.toISOString() }),
                status: 'SUCCESS',
                tenantId,
            },
        });

        revalidatePath('/revenue');
        revalidatePath('/reports');
        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Update Revenue Error:', error);
        return { success: false, error: '更新失敗' };
    }
}

export async function deleteRevenue(id: string) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const user = auth.user;
        const tenantId = await getTenantId();

        // 驗證所有權
        const record = await prisma.revenue.findFirst({
            where: { id, tenantId },
            include: { location: true },
        });
        if (!record) {
            return { success: false, error: '找不到營收記錄' };
        }

        await prisma.revenue.delete({ where: { id } });

        await prisma.operationLog.create({
            data: {
                action: 'DELETE',
                module: 'REVENUE',
                userId: user.id,
                target: id,
                details: JSON.stringify({
                    location: record.location?.name || null,
                    amount: record.amount,
                    isDayOff: record.isDayOff,
                    date: record.date.toISOString(),
                }),
                status: 'SUCCESS',
                tenantId,
            },
        });

        revalidatePath('/revenue');
        revalidatePath('/reports');
        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Delete Revenue Error:', error);
        return { success: false, error: '刪除失敗' };
    }
}
