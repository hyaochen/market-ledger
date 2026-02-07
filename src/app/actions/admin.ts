'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto'; // 簡單雜湊用，生產環境建議用 bcrypt
import { ensureRole, getTenantId } from '@/lib/auth';

// --- Department Actions ---

export async function getDepartments() {
    const tenantId = await getTenantId();

    return await prisma.department.findMany({
        where: { tenantId },
        orderBy: { sortOrder: 'asc' },
        include: {
            children: true,
            _count: { select: { users: true } }
        }
    });
}

export async function createDepartment(data: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = data.get('name') as string;
        const parentId = data.get('parentId') as string;
        const sortOrder = parseInt(data.get('sortOrder') as string) || 0;

        await prisma.department.create({
            data: {
                name,
                parentId: parentId === 'root' ? null : parentId,
                sortOrder,
                tenantId,
            }
        });

        revalidatePath('/settings/department');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立失敗' };
    }
}

export async function deleteDepartment(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.department.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '部門不存在或無權限' };

        await prisma.department.delete({ where: { id } });
        revalidatePath('/settings/department');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗 (可能含有子部門或成員)' };
    }
}

// --- User Actions ---

export async function getUsers() {
    const tenantId = await getTenantId();

    return await prisma.user.findMany({
        where: { tenantId },
        include: {
            department: true,
            roles: {
                include: {
                    role: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createUser(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const username = formData.get('username') as string;
        const realName = formData.get('realName') as string;
        const password = formData.get('password') as string;
        const departmentId = formData.get('departmentId') as string;
        const roleIds = formData.getAll('roles') as string[];

        if (!roleIds.length) {
            return { success: false, error: '請選擇角色' };
        }

        // 簡單加密 (實際專案請用 bcrypt)
        const hashedPassword = createHash('sha256').update(password).digest('hex');

        await prisma.user.create({
            data: {
                username,
                realName,
                password: hashedPassword,
                departmentId: departmentId && departmentId !== 'none' ? departmentId : null,
                tenantId,
                roles: {
                    create: roleIds.map(rid => ({ roleId: rid }))
                }
            }
        });

        revalidatePath('/settings/users');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立使用者失敗' };
    }
}

// --- Role Actions ---

const DEFAULT_ROLES = [
    { name: '讀取者', code: 'read', description: '僅能查看資料 (讀取權限)' },
    { name: '編輯者', code: 'write', description: '可新增與修改資料 (含讀取權限)' },
    { name: '管理者', code: 'admin', description: '可管理權限與功能設定 (含全部權限)' },
];

export async function ensureDefaultRoles() {
    for (const role of DEFAULT_ROLES) {
        await prisma.role.upsert({
            where: { code: role.code },
            update: { name: role.name, description: role.description, status: true },
            create: { name: role.name, code: role.code, description: role.description, status: true },
        });
    }
}

export async function getRoles() {
    await ensureDefaultRoles();
    return await prisma.role.findMany({
        orderBy: { createdAt: 'asc' }
    });
}

export async function syncDefaultRoles() {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };

        await ensureDefaultRoles();
        revalidatePath('/settings/roles');
        revalidatePath('/settings/users');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '補齊角色失敗' };
    }
}

// --- Dictionary Actions ---

export async function getDictionary(category?: string) {
    const tenantId = await getTenantId();

    return await prisma.dictionary.findMany({
        where: category ? { category, tenantId } : { tenantId },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
    });
}

export async function createDictionaryItem(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const category = formData.get('category') as string;
        const label = formData.get('label') as string;
        const value = formData.get('value') as string;
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        await prisma.dictionary.create({
            data: { category, label, value, sortOrder, tenantId }
        });

        revalidatePath('/settings/dictionary');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立失敗' };
    }
}

export async function deleteDictionaryItem(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        // 驗證所有權
        const existing = await prisma.dictionary.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '字典項目不存在或無權限' };

        await prisma.dictionary.delete({ where: { id } });
        revalidatePath('/settings/dictionary');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗' };
    }
}

// --- Log Actions ---

export async function getOperationLogs() {
    const tenantId = await getTenantId();

    return await prisma.operationLog.findMany({
        where: { tenantId },
        include: {
            user: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
    });
}

// --- Region Actions ---

export async function getRegions() {
    const tenantId = await getTenantId();

    return await prisma.region.findMany({
        where: { tenantId },
        include: { locations: { orderBy: { name: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
    });
}

export async function createRegion(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = (formData.get('name') as string)?.trim();
        const code = (formData.get('code') as string)?.trim() || null;

        if (!name) return { success: false, error: '請填寫區域名稱' };

        await prisma.region.create({
            data: { name, code, tenantId }
        });

        revalidatePath('/settings/region');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立區域失敗（名稱可能重複）' };
    }
}

export async function toggleRegionStatus(id: string, isActive: boolean) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const existing = await prisma.region.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '區域不存在' };

        await prisma.region.update({ where: { id }, data: { isActive } });
        revalidatePath('/settings/region');
        return { success: true };
    } catch (e) {
        return { success: false, error: '更新失敗' };
    }
}

export async function deleteRegion(id: string) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const existing = await prisma.region.findFirst({
            where: { id, tenantId },
            include: { _count: { select: { locations: true } } },
        });
        if (!existing) return { success: false, error: '區域不存在' };
        if (existing._count.locations > 0) {
            return { success: false, error: '此區域下仍有場所，請先移除場所' };
        }

        await prisma.region.delete({ where: { id } });
        revalidatePath('/settings/region');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗' };
    }
}

// --- Location Actions ---

export async function createLocation(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const name = (formData.get('name') as string)?.trim();
        const regionId = formData.get('regionId') as string;

        if (!name) return { success: false, error: '請填寫場所名稱' };

        await prisma.location.create({
            data: { name, regionId: regionId || null, tenantId }
        });

        revalidatePath('/settings/region');
        revalidatePath('/revenue');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立場所失敗（名稱可能重複）' };
    }
}

export async function toggleLocationStatus(id: string, isActive: boolean) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };
        const tenantId = await getTenantId();

        const existing = await prisma.location.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '場所不存在' };

        await prisma.location.update({ where: { id }, data: { isActive } });
        revalidatePath('/settings/region');
        revalidatePath('/revenue');
        return { success: true };
    } catch (e) {
        return { success: false, error: '更新失敗' };
    }
}

// --- Menu/Permission Actions ---

export async function getPermissions() {
    return await prisma.permission.findMany({
        orderBy: { sortOrder: 'asc' }
    });
}

export async function createPermission(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };

        const name = formData.get('name') as string;
        const code = formData.get('code') as string;
        const type = formData.get('type') as string;
        const path = formData.get('path') as string;
        const icon = formData.get('icon') as string;
        const parentId = formData.get('parentId') as string;

        await prisma.permission.create({
            data: {
                name,
                code,
                type,
                path,
                icon,
                parentId: parentId === 'root' ? null : parentId
            }
        });

        revalidatePath('/settings/menu');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立功能表失敗' };
    }
}

// Helper for hash is imported above.
