'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { parseLocalDate } from '@/lib/date';
import { ensureRole } from '@/lib/auth';

export async function recordRevenue(date: string, locationId: string, amount: number, isDayOff: boolean) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };

        const targetDate = parseLocalDate(date) ?? new Date();

        // 使用 upsert: 如果存在則更新，不存在則新增
        await prisma.revenue.upsert({
            where: {
                date_locationId: {
                    date: targetDate,
                    locationId: locationId
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
                isDayOff: isDayOff
            }
        });

        revalidatePath('/revenue');
        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Record Revenue Error:', error);
        return { success: false, error: '儲存失敗' };
    }
}

export async function getRevenueByDate(date: string) {
    const targetDate = parseLocalDate(date) ?? new Date();

    const records = await prisma.revenue.findMany({
        where: {
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

        const amount = Number.parseFloat(formData.get('amount') as string);
        const isDayOff = formData.get('isDayOff') === 'on';
        const dateInput = formData.get('date') as string | null;
        const date = parseLocalDate(dateInput) ?? new Date();

        if (!Number.isFinite(amount) || amount < 0) {
            return { success: false, error: '請填寫正確金額' };
        }

        await prisma.revenue.update({
            where: { id },
            data: {
                date,
                amount: isDayOff ? 0 : amount,
                isDayOff,
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
