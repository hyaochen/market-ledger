'use server';

import prisma from '@/lib/prisma';
import { getTenantId } from '@/lib/auth';

export async function getCommonData() {
    const tenantId = await getTenantId();

    const [categories, items, vendors, locations] = await Promise.all([
        prisma.category.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
        prisma.item.findMany({ where: { isActive: true, tenantId }, orderBy: { sortOrder: 'asc' } }),
        prisma.vendor.findMany({ where: { isActive: true, tenantId } }),
        prisma.location.findMany({ where: { isActive: true, tenantId } })
    ]);

    return { categories, items, vendors, locations };
}
