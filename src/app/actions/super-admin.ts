'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { hashPasswordAsync } from '@/lib/password';
import { getCurrentUser } from '@/lib/auth';
import { usernameTaken, validateNewPassword, validateUsername } from '@/lib/username';
import {
    buildPasswordResetAudit,
    buildTenantCreateAudit,
    buildTenantStatusAudit,
    buildTenantUpdateAudit,
    recordPrivilegedAudit,
    requestIp,
    writePrivilegedAudit,
} from '@/lib/privileged-audit';

async function requireSuperAdmin() {
    const user = await getCurrentUser();
    if (!user || !user.isSuperAdmin) {
        return { ok: false, error: '需要超級管理員權限' } as const;
    }
    return { ok: true, user } as const;
}

export async function getTenants() {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return [];

    return prisma.tenant.findMany({
        include: {
            _count: {
                select: { users: true, entries: true, revenues: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });
}

export async function getTenantById(id: string) {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return null;

    return prisma.tenant.findUnique({
        where: { id },
        include: {
            users: {
                select: { id: true, username: true, realName: true, status: true },
                orderBy: { createdAt: 'asc' },
            },
            _count: {
                select: { users: true, entries: true, revenues: true, items: true, vendors: true, locations: true },
            },
        },
    });
}

export async function createTenant(formData: FormData) {
    try {
        const auth = await requireSuperAdmin();
        if (!auth.ok) return { success: false, error: auth.error };

        const name = (formData.get('name') as string | null)?.trim();
        const code = (formData.get('code') as string | null)?.trim();
        const adminUsername = (formData.get('adminUsername') as string | null)?.trim();
        const adminPassword = (formData.get('adminPassword') as string | null)?.trim();
        const note = (formData.get('note') as string | null)?.trim() || null;

        if (!name || !code || !adminUsername || !adminPassword) {
            return { success: false, error: '請填寫所有必填欄位' };
        }

        const pwErr = validateNewPassword(adminPassword);
        if (pwErr) return { success: false, error: pwErr };
        const nameErr = validateUsername(adminUsername);
        if (nameErr) return { success: false, error: nameErr };

        // Check code uniqueness
        const existing = await prisma.tenant.findUnique({ where: { code } });
        if (existing) {
            return { success: false, error: '企業代碼已存在' };
        }

        // 登入是全域查帳號，管理者帳號名稱不可與任何租戶重複（不分大小寫）
        if (await usernameTaken(adminUsername)) {
            return { success: false, error: '此帳號名稱已被使用' };
        }

        const hashedPassword = await hashPasswordAsync(adminPassword);

        // Find the admin role
        const adminRole = await prisma.role.findFirst({ where: { code: 'admin' } });
        if (!adminRole) {
            return { success: false, error: '系統角色尚未建立，請先執行 seed' };
        }

        const ip = await requestIp();

        // Create tenant + admin user (+ 稽核紀錄) in a transaction
        const tenant = await prisma.$transaction(async (tx) => {
            const newTenant = await tx.tenant.create({
                data: { name, code, note },
            });

            const adminUser = await tx.user.create({
                data: {
                    username: adminUsername,
                    password: hashedPassword,
                    realName: `${name} 管理員`,
                    tenantId: newTenant.id,
                    roles: {
                        create: { roleId: adminRole.id },
                    },
                },
            });

            await writePrivilegedAudit(tx, buildTenantCreateAudit({
                actorId: auth.user.id,
                ip,
                tenantId: newTenant.id,
                code,
                name,
                note,
                adminUserId: adminUser.id,
                adminUsername,
            }));

            return newTenant;
        });

        revalidatePath('/super-admin');
        revalidatePath('/super-admin/tenants');
        return { success: true, tenant };
    } catch (error) {
        console.error(error);
        return { success: false, error: '建立企業失敗' };
    }
}

export async function updateTenant(id: string, formData: FormData) {
    try {
        const auth = await requireSuperAdmin();
        if (!auth.ok) return { success: false, error: auth.error };

        const name = (formData.get('name') as string | null)?.trim();
        const note = (formData.get('note') as string | null)?.trim() || null;

        if (!name) {
            return { success: false, error: '請填寫企業名稱' };
        }

        const ip = await requestIp();
        // 稽核寫在同一個交易裡；企業不存在時 update 會丟錯，行為與原本相同（走 catch）
        await prisma.$transaction(async (tx) => {
            const before = await tx.tenant.findUnique({ where: { id }, select: { code: true, name: true, note: true } });
            await tx.tenant.update({
                where: { id },
                data: { name, note },
            });
            await writePrivilegedAudit(tx, buildTenantUpdateAudit({
                actorId: auth.user.id,
                ip,
                tenantId: id,
                code: before?.code ?? id,
                before: { name: before?.name ?? '', note: before?.note ?? null },
                after: { name, note },
            }));
        });

        revalidatePath('/super-admin');
        revalidatePath('/super-admin/tenants');
        revalidatePath(`/super-admin/tenants/${id}`);
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新企業失敗' };
    }
}

export async function toggleTenantStatus(id: string, status: boolean) {
    try {
        const auth = await requireSuperAdmin();
        if (!auth.ok) return { success: false, error: auth.error };

        const ip = await requestIp();
        await prisma.$transaction(async (tx) => {
            const before = await tx.tenant.findUnique({ where: { id }, select: { code: true, name: true, status: true } });
            await tx.tenant.update({
                where: { id },
                data: { status },
            });
            await writePrivilegedAudit(tx, buildTenantStatusAudit({
                actorId: auth.user.id,
                ip,
                tenantId: id,
                code: before?.code ?? id,
                name: before?.name ?? '',
                before: before?.status ?? false,
                after: status,
            }));
        });

        revalidatePath('/super-admin');
        revalidatePath('/super-admin/tenants');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '更新企業狀態失敗' };
    }
}

export async function resetUserPassword(userId: string, newPassword: string) {
    try {
        const auth = await requireSuperAdmin();
        if (!auth.ok) return { success: false, error: auth.error };

        const pwErr = validateNewPassword(newPassword);
        if (pwErr) return { success: false, error: pwErr };

        const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, tenantId: true } });
        if (!target) return { success: false, error: '使用者不存在' };

        const hashedPassword = await hashPasswordAsync(newPassword);

        // 密碼 hash 一變，session 內的密碼指紋就對不上，該使用者所有舊 session 立即失效
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });
        // Telegram bot 的 session 不帶密碼指紋，要另外刪掉（存成 JSON，見 bot/auth.ts saveSession）
        await prisma.systemConfig.deleteMany({
            where: { key: { startsWith: 'tg_session_' }, value: { contains: `"userId":"${userId}"` } },
        });

        // 稽核只記誰重設了誰；不記任何密碼相關的值。操作成功之後才寫，失敗不回滾
        await recordPrivilegedAudit(buildPasswordResetAudit({
            actorId: auth.user.id,
            ip: await requestIp(),
            tenantId: target.tenantId,
            userId: target.id,
            username: target.username,
        }));

        revalidatePath('/super-admin');
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: '重設密碼失敗' };
    }
}

export async function getSuperAdminStats() {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return null;

    const [tenantCount, userCount, entryCount, revenueCount] = await Promise.all([
        prisma.tenant.count(),
        prisma.user.count({ where: { isSuperAdmin: false } }),
        prisma.entry.count(),
        prisma.revenue.count(),
    ]);

    return { tenantCount, userCount, entryCount, revenueCount };
}
