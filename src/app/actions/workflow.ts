'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensureRole, getTenantId } from '@/lib/auth';

export async function updateEntryStatus(id: string, status: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.entry.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '記錄不存在或無權限' };

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
                status: 'SUCCESS',
                tenantId,
            }
        });

        revalidatePath('/inventory');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '更新失敗' };
    }
}
