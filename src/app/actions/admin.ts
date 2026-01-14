'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto'; // 簡單雜湊用，生產環境建議用 bcrypt
import { ensureRole } from '@/lib/auth';

// --- Department Actions ---

export async function getDepartments() {
    return await prisma.department.findMany({
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

        const name = data.get('name') as string;
        const parentId = data.get('parentId') as string;
        const sortOrder = parseInt(data.get('sortOrder') as string) || 0;

        await prisma.department.create({
            data: {
                name,
                parentId: parentId === 'root' ? null : parentId,
                sortOrder
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

        await prisma.department.delete({ where: { id } });
        revalidatePath('/settings/department');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗 (可能含有子部門或成員)' };
    }
}

// --- User Actions ---

export async function getUsers() {
    return await prisma.user.findMany({
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
    return await prisma.dictionary.findMany({
        where: category ? { category } : {},
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
    });
}

export async function createDictionaryItem(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };

        const category = formData.get('category') as string;
        const label = formData.get('label') as string;
        const value = formData.get('value') as string;
        const sortOrder = parseInt(formData.get('sortOrder') as string) || 0;

        await prisma.dictionary.create({
            data: { category, label, value, sortOrder }
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

        await prisma.dictionary.delete({ where: { id } });
        revalidatePath('/settings/dictionary');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗' };
    }
}

// --- Log Actions ---

export async function getOperationLogs() {
    return await prisma.operationLog.findMany({
        include: {
            user: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
    });
}

// --- Region Actions ---

export async function getRegions() {
    return await prisma.region.findMany({
        orderBy: { code: 'asc' }
    });
}

export async function createRegion(formData: FormData) {
    try {
        const auth = await ensureRole('admin');
        if (!auth.ok) return { success: false, error: auth.error };

        const name = formData.get('name') as string;
        const code = formData.get('code') as string;
        const type = formData.get('type') as string;
        const parentId = formData.get('parentId') as string;

        await prisma.region.create({
            data: {
                name,
                code,
                type,
                parentId: parentId === 'root' ? null : parentId
            }
        });

        revalidatePath('/settings/region');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立區域失敗' };
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
