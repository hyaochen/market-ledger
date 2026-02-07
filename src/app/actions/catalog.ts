'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { UNITS, type UnitDef, parseUnitMeta } from '@/lib/units';
import { ensureRole, getTenantId } from '@/lib/auth';

const UNIT_CATEGORY = 'unit';
const EXPENSE_CATEGORY = 'expense_type';

export async function getUnits(): Promise<UnitDef[]> {
    const tenantId = await getTenantId();

    const rows = await prisma.dictionary.findMany({
        where: { category: UNIT_CATEGORY, isActive: true, tenantId },
        orderBy: { sortOrder: 'asc' },
    });

    if (rows.length === 0) return UNITS;

    return rows.map((row) => {
        const meta = parseUnitMeta(row.meta);
        return {
            code: row.value,
            name: row.label,
            toKg: meta.toKg,
            isWeight: meta.isWeight ?? typeof meta.toKg === 'number',
        };
    });
}

export async function createCategory(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = (formData.get('name') as string | null)?.trim();
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        if (!name) {
            return { success: false, error: '請填寫類別名稱' };
        }

        const category = await prisma.category.upsert({
            where: { name_tenantId: { name, tenantId } },
            update: { sortOrder },
            create: { name, sortOrder, tenantId },
        });

        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true, category };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立類別失敗' };
    }
}

export async function createItem(formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = (formData.get('name') as string | null)?.trim();
        const categoryId = (formData.get('categoryId') as string | null)?.trim();
        const defaultUnit = (formData.get('defaultUnit') as string | null)?.trim() || 'kg';
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        if (!name || !categoryId) {
            return { success: false, error: '請填寫品項與類別' };
        }

        const item = await prisma.item.upsert({
            where: { name_categoryId_tenantId: { name, categoryId, tenantId } },
            update: { defaultUnit, isActive: true, sortOrder },
            create: { name, categoryId, defaultUnit, sortOrder, tenantId },
        });

        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true, item };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立品項失敗' };
    }
}

export async function toggleItemStatus(id: string, isActive: boolean) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.item.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '品項不存在或無權限' };

        await prisma.item.update({
            where: { id },
            data: { isActive },
        });
        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新品項狀態失敗' };
    }
}

export async function createVendor(formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = (formData.get('name') as string | null)?.trim();
        const contact = (formData.get('contact') as string | null)?.trim() || null;
        const phone = (formData.get('phone') as string | null)?.trim() || null;
        const note = (formData.get('note') as string | null)?.trim() || null;

        if (!name) {
            return { success: false, error: '請填寫廠商名稱' };
        }

        const vendor = await prisma.vendor.upsert({
            where: { name_tenantId: { name, tenantId } },
            update: { contact, phone, note, isActive: true },
            create: { name, contact, phone, note, tenantId },
        });

        revalidatePath('/settings/vendors');
        revalidatePath('/entry/new');
        return { success: true, vendor };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立廠商失敗' };
    }
}

export async function toggleVendorStatus(id: string, isActive: boolean) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.vendor.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '廠商不存在或無權限' };

        await prisma.vendor.update({
            where: { id },
            data: { isActive },
        });
        revalidatePath('/settings/vendors');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新廠商狀態失敗' };
    }
}

export async function createExpenseType(formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const label = (formData.get('label') as string | null)?.trim();
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        if (!label) {
            return { success: false, error: '請填寫支出名稱' };
        }

        // 自動產生序號代碼
        const count = await prisma.dictionary.count({
            where: { category: EXPENSE_CATEGORY, tenantId },
        });
        const value = `EXP${String(count + 1).padStart(3, '0')}`;

        const item = await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: EXPENSE_CATEGORY, value, tenantId } },
            update: { label, sortOrder, isActive: true },
            create: { category: EXPENSE_CATEGORY, label, value, sortOrder, isActive: true, tenantId },
        });

        revalidatePath('/settings/dictionary');
        revalidatePath('/settings/expenses');
        revalidatePath('/entry/new');
        return { success: true, expenseType: item };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立支出項目失敗' };
    }
}

export async function createUnit(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const label = (formData.get('label') as string | null)?.trim();
        const value = (formData.get('value') as string | null)?.trim();
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;
        const isWeight = formData.get('isWeight') === 'on';
        const toKgRaw = (formData.get('toKg') as string | null)?.trim();
        const toKg = toKgRaw ? parseFloat(toKgRaw) : undefined;

        if (!label || !value) {
            return { success: false, error: '請填寫單位名稱與代碼' };
        }

        if (isWeight && (!toKg || toKg <= 0)) {
            return { success: false, error: '秤重單位請填寫正確換算值' };
        }

        const meta = JSON.stringify({
            isWeight,
            toKg: isWeight ? toKg : undefined,
        });

        const unit = await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: UNIT_CATEGORY, value, tenantId } },
            update: { label, sortOrder, isActive: true, meta },
            create: { category: UNIT_CATEGORY, label, value, sortOrder, isActive: true, meta, tenantId },
        });

        revalidatePath('/settings/units');
        revalidatePath('/entry/new');
        return { success: true, unit };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立單位失敗' };
    }
}

export async function toggleDictionaryStatus(id: string, isActive: boolean) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.dictionary.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '字典項目不存在或無權限' };

        await prisma.dictionary.update({
            where: { id },
            data: { isActive },
        });
        revalidatePath('/settings/units');
        revalidatePath('/settings/dictionary');
        revalidatePath('/settings/expenses');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新狀態失敗' };
    }
}

export async function updateItem(id: string, formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.item.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '品項不存在或無權限' };

        const name = (formData.get('name') as string | null)?.trim();
        const categoryId = (formData.get('categoryId') as string | null)?.trim();
        const defaultUnit = (formData.get('defaultUnit') as string | null)?.trim() || 'kg';
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        if (!name || !categoryId) {
            return { success: false, error: '請填寫品項與類別' };
        }

        await prisma.item.update({
            where: { id },
            data: { name, categoryId, defaultUnit, sortOrder },
        });

        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新品項失敗' };
    }
}

export async function deleteItem(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.item.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '品項不存在或無權限' };

        await prisma.item.delete({ where: { id } });
        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '刪除品項失敗 (可能已被記錄使用)' };
    }
}

export async function deleteVendor(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.vendor.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '廠商不存在或無權限' };

        await prisma.vendor.delete({ where: { id } });
        revalidatePath('/settings/vendors');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '刪除廠商失敗 (可能已被記錄使用)' };
    }
}

export async function deleteCategory(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.category.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '類別不存在或無權限' };

        const items = await prisma.item.count({ where: { categoryId: id, tenantId } });
        if (items > 0) {
            return { success: false, error: '請先刪除或移動該類別下的品項' };
        }

        await prisma.category.delete({ where: { id } });
        revalidatePath('/settings/items');
        revalidatePath('/entry/new');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '刪除類別失敗' };
    }
}
