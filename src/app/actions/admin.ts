'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { hashPasswordAsync } from '@/lib/password';
import { ensureRole, getCurrentUser } from '@/lib/auth';
import { usernameTaken, validateNewPassword, validateUsername } from '@/lib/username';

// 本檔 export 的每個 function 都是可被任何人直接呼叫的 server action，
// 所以每一個都要自己驗證角色與租戶，不能只靠頁面 / layout 擋。

/** 通過 admin 驗證並取得租戶範圍；沒有租戶 context（沒進企業的 super admin）一律拒絕。 */
async function adminScope() {
    const auth = await ensureRole('admin');
    if (!auth.ok) return { ok: false, error: auth.error } as const;
    const tenantId = auth.user.tenantId;
    if (!tenantId) return { ok: false, error: '請先進入企業' } as const;
    return { ok: true, user: auth.user, tenantId } as const;
}

/** 租戶內除了 excludeUserId 之外，是否還有啟用中的管理者 */
async function hasOtherActiveAdmin(tenantId: string, excludeUserId: string) {
    const n = await prisma.user.count({
        where: {
            tenantId,
            status: true,
            id: { not: excludeUserId },
            roles: { some: { role: { code: 'admin' } } },
        },
    });
    return n > 0;
}

async function isActiveAdmin(userId: string) {
    const n = await prisma.user.count({
        where: { id: userId, status: true, roles: { some: { role: { code: 'admin' } } } },
    });
    return n > 0;
}

// --- Department Actions ---

export async function getDepartments() {
    const scope = await adminScope();
    if (!scope.ok) return [];

    return await prisma.department.findMany({
        where: { tenantId: scope.tenantId },
        orderBy: { sortOrder: 'asc' },
        include: {
            children: true,
            _count: { select: { users: true } }
        }
    });
}

export async function createDepartment(data: FormData) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const name = (data.get('name') as string | null)?.trim();
        const parentId = data.get('parentId') as string;
        const sortOrder = parseInt(data.get('sortOrder') as string) || 0;
        if (!name) return { success: false, error: '請填寫部門名稱' };

        let parent: string | null = null;
        if (parentId && parentId !== 'root') {
            const p = await prisma.department.findFirst({ where: { id: parentId, tenantId } });
            if (!p) return { success: false, error: '上層部門不存在或無權限' };
            parent = p.id;
        }

        await prisma.department.create({
            data: { name, parentId: parent, sortOrder, tenantId }
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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
    const scope = await adminScope();
    if (!scope.ok) return [];

    // 明確 select：絕不把 password hash 帶出來
    return await prisma.user.findMany({
        where: { tenantId: scope.tenantId },
        select: {
            id: true,
            username: true,
            realName: true,
            email: true,
            phone: true,
            status: true,
            tenantId: true,
            departmentId: true,
            createdAt: true,
            department: true,
            roles: {
                select: {
                    role: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createUser(formData: FormData) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const username = ((formData.get('username') as string | null) ?? '').trim();
        const realName = (formData.get('realName') as string | null)?.trim() || null;
        const password = formData.get('password') as string | null;
        const departmentId = formData.get('departmentId') as string | null;
        const roleIds = Array.from(new Set(formData.getAll('roles') as string[]));

        const nameErr = validateUsername(username);
        if (nameErr) return { success: false, error: nameErr };
        const pwErr = validateNewPassword(password);
        if (pwErr) return { success: false, error: pwErr };

        if (!roleIds.length) {
            return { success: false, error: '請選擇角色' };
        }
        const roles = await prisma.role.findMany({ where: { id: { in: roleIds }, status: true }, select: { id: true } });
        if (roles.length !== roleIds.length) {
            return { success: false, error: '角色不存在' };
        }

        let deptId: string | null = null;
        if (departmentId && departmentId !== 'none') {
            const dept = await prisma.department.findFirst({ where: { id: departmentId, tenantId }, select: { id: true } });
            if (!dept) return { success: false, error: '部門不存在或無權限' };
            deptId = dept.id;
        }

        // 登入是全域查帳號，所以帳號名稱不可與任何租戶重複（不分大小寫）
        if (await usernameTaken(username)) {
            return { success: false, error: '此帳號名稱已被使用' };
        }

        const hashedPassword = await hashPasswordAsync(password as string);

        await prisma.user.create({
            data: {
                username,
                realName,
                password: hashedPassword,
                departmentId: deptId,
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

export async function toggleUserStatus(id: string, status: boolean) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const existing = await prisma.user.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '使用者不存在或無權限' };

        if (status === false) {
            if (id === scope.user.id) return { success: false, error: '不能停用自己的帳號' };
            if (existing.status && await isActiveAdmin(id) && !(await hasOtherActiveAdmin(tenantId, id))) {
                return { success: false, error: '不能停用此企業最後一位管理者' };
            }
        }

        await prisma.user.update({ where: { id }, data: { status } });
        revalidatePath('/settings/users');
        return { success: true };
    } catch (e) {
        return { success: false, error: '更新失敗' };
    }
}

export async function deleteUser(id: string) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const existing = await prisma.user.findFirst({ where: { id, tenantId } });
        if (!existing) return { success: false, error: '使用者不存在或無權限' };

        if (id === scope.user.id) return { success: false, error: '不能刪除自己的帳號' };
        if (existing.status && await isActiveAdmin(id) && !(await hasOtherActiveAdmin(tenantId, id))) {
            return { success: false, error: '不能刪除此企業最後一位管理者' };
        }

        await prisma.user.delete({ where: { id } });
        await prisma.systemConfig.deleteMany({ where: { key: `sessions_valid_after:${id}`, tenantId: null } });
        revalidatePath('/settings/users');
        return { success: true };
    } catch (e) {
        return { success: false, error: '刪除失敗' };
    }
}

export async function updateUserRole(userId: string, roleId: string) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const existing = await prisma.user.findFirst({ where: { id: userId, tenantId } });
        if (!existing) return { success: false, error: '使用者不存在或無權限' };

        const role = await prisma.role.findFirst({ where: { id: roleId, status: true } });
        if (!role) return { success: false, error: '角色不存在' };

        if (role.code !== 'admin') {
            if (userId === scope.user.id) return { success: false, error: '不能降低自己的權限' };
            if (existing.status && await isActiveAdmin(userId) && !(await hasOtherActiveAdmin(tenantId, userId))) {
                return { success: false, error: '不能降級此企業最後一位管理者' };
            }
        }

        await prisma.$transaction([
            prisma.userRole.deleteMany({ where: { userId } }),
            prisma.userRole.create({ data: { userId, roleId } }),
        ]);

        revalidatePath('/settings/users');
        return { success: true };
    } catch (e) {
        return { success: false, error: '更新角色失敗' };
    }
}

// --- Role Actions ---

const DEFAULT_ROLES = [
    { name: '讀取者', code: 'read', description: '僅能查看資料 (讀取權限)' },
    { name: '編輯者', code: 'write', description: '可新增與修改資料 (含讀取權限)' },
    { name: '管理者', code: 'admin', description: '可管理權限與功能設定 (含全部權限)' },
];

// 只補「缺少」的預設角色；已存在的不動（不再每次讀取都 upsert 寫入）。
async function ensureDefaultRoles() {
    const existing = await prisma.role.findMany({ select: { code: true } });
    const have = new Set(existing.map((r) => r.code));
    for (const role of DEFAULT_ROLES) {
        if (have.has(role.code)) continue;
        // upsert + 空 update：兩個請求同時第一次讀角色時不會因 unique 衝突而丟錯，也不覆寫既有角色
        await prisma.role.upsert({
            where: { code: role.code },
            update: {},
            create: { name: role.name, code: role.code, description: role.description, status: true },
        });
    }
}

export async function getRoles() {
    const auth = await ensureRole('admin');
    if (!auth.ok) return [];
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
    const scope = await adminScope();
    if (!scope.ok) return [];
    const tenantId = scope.tenantId;

    return await prisma.dictionary.findMany({
        where: category ? { category, tenantId } : { tenantId },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }]
    });
}

export async function createDictionaryItem(formData: FormData) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
    const scope = await adminScope();
    if (!scope.ok) return [];

    return await prisma.operationLog.findMany({
        where: { tenantId: scope.tenantId },
        include: {
            // 只取顯示名稱，不帶 password hash
            user: { select: { username: true, realName: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
    });
}

// --- Region Actions ---

export async function getRegions() {
    const scope = await adminScope();
    if (!scope.ok) return [];

    return await prisma.region.findMany({
        where: { tenantId: scope.tenantId },
        include: { locations: { orderBy: { name: 'asc' } } },
        orderBy: { sortOrder: 'asc' },
    });
}

export async function createRegion(formData: FormData) {
    try {
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

        const name = (formData.get('name') as string)?.trim();
        const regionId = formData.get('regionId') as string;

        if (!name) return { success: false, error: '請填寫場所名稱' };

        if (regionId) {
            const region = await prisma.region.findFirst({ where: { id: regionId, tenantId }, select: { id: true } });
            if (!region) return { success: false, error: '區域不存在或無權限' };
        }

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
        const scope = await adminScope();
        if (!scope.ok) return { success: false, error: scope.error };
        const tenantId = scope.tenantId;

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
    const auth = await ensureRole('admin');
    if (!auth.ok) return [];
    return await prisma.permission.findMany({
        orderBy: { sortOrder: 'asc' }
    });
}

// Permission 是全域資料（沒有 tenantId），租戶管理者不可寫入；只有 super admin 可以。
export async function createPermission(formData: FormData) {
    try {
        const user = await getCurrentUser();
        if (!user) return { success: false, error: '請先登入' };
        if (!user.isSuperAdmin) return { success: false, error: '權限不足' };

        const name = (formData.get('name') as string | null)?.trim();
        const code = (formData.get('code') as string | null)?.trim();
        const type = (formData.get('type') as string | null)?.trim();
        const path = (formData.get('path') as string | null)?.trim() || null;
        const icon = (formData.get('icon') as string | null)?.trim() || null;
        const parentId = formData.get('parentId') as string | null;

        if (!name || !code || !type) return { success: false, error: '請填寫名稱、代碼與類型' };
        if (!['MENU', 'BUTTON', 'API'].includes(type)) return { success: false, error: '類型不正確' };

        let parent: string | null = null;
        if (parentId && parentId !== 'root') {
            const p = await prisma.permission.findUnique({ where: { id: parentId }, select: { id: true } });
            if (!p) return { success: false, error: '上層功能表不存在' };
            parent = p.id;
        }

        await prisma.permission.create({
            data: { name, code, type, path, icon, parentId: parent }
        });

        revalidatePath('/settings/menu');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, error: '建立功能表失敗' };
    }
}
