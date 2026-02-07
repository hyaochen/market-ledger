'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensureRole, getTenantId } from '@/lib/auth';

export async function createTemplate(formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, message: auth.error };
        const user = auth.user;
        const tenantId = await getTenantId();

        const name = formData.get('name') as string;
        const type = formData.get('type') as string;

        if (!name || !type) {
            return { success: false, message: '請提供模板名稱和類型' };
        }

        const data: any = {
            name,
            type,
            userId: user.id,
            note: (formData.get('note') as string | null)?.trim() || null,
            tenantId,
        };

        if (type === 'PURCHASE') {
            const itemId = formData.get('itemId') as string;
            const vendorId = formData.get('vendorId') as string;
            const weight = formData.get('weight') as string;
            const unit = formData.get('unit') as string;
            const price = formData.get('price') as string;

            data.itemId = itemId || null;
            data.vendorId = (!vendorId || vendorId === 'none') ? null : vendorId;
            data.inputQuantity = weight ? Number.parseFloat(weight) : null;
            data.inputUnit = unit || null;
            data.totalPrice = price ? Number.parseFloat(price) : null;

            // 如果同時有數量和總價，我們可以算出預設單價，但這裡先不強制存
            if (data.totalPrice && data.inputQuantity) {
                data.unitPrice = data.totalPrice / data.inputQuantity;
            }

        } else if (type === 'EXPENSE') {
            const expenseType = formData.get('expenseType') as string;
            const amount = formData.get('amount') as string;

            data.expenseType = expenseType || null;
            data.totalPrice = amount ? Number.parseFloat(amount) : null;
        }

        await prisma.entryTemplate.create({
            data,
        });

        revalidatePath('/entry/new');
        return { success: true, message: '常用記錄已儲存' };
    } catch (error) {
        console.error('Create Template Error:', error);
        return { success: false, message: '儲存失敗' };
    }
}

export async function getTemplates(type?: string) {
    const auth = await ensureRole('read');
    if (!auth.ok) return [];
    const tenantId = await getTenantId();

    return await prisma.entryTemplate.findMany({
        where: type ? { type, tenantId } : { tenantId },
        orderBy: { createdAt: 'desc' }, // 新的在庫
    });
}

export async function deleteTemplate(id: string) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, message: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.entryTemplate.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, message: '模板不存在或無權限' };

        await prisma.entryTemplate.delete({
            where: { id },
        });

        revalidatePath('/entry/new');
        return { success: true, message: '已刪除' };
    } catch (error) {
        console.error('Delete Template Error:', error);
        return { success: false, message: '刪除失敗' };
    }
}
