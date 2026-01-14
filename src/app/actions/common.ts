'use server';

import prisma from '@/lib/prisma';

export async function getCommonData() {
    const [categories, items, vendors, locations] = await Promise.all([
        prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
        prisma.item.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.vendor.findMany({ where: { isActive: true } }),
        prisma.location.findMany({ where: { isActive: true } })
    ]);

    return { categories, items, vendors, locations };
}
