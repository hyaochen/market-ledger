'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensureRole } from '@/lib/auth';

export async function updateEntryStatus(id: string, status: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };

        await prisma.entry.update({
            where: { id },
            data: { status }
        });

        // 記錄日誌
        await prisma.operationLog.create({
            data: {
                action: 'UPDATE',
                module: 'ENTRY',
                target: id,
                details: `Status changed to ${status}`,
                status: 'SUCCESS'
            }
        });

        revalidatePath('/inventory');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '更新失敗' };
    }
}
