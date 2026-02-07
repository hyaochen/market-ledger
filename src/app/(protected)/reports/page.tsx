import prisma from "@/lib/prisma";
import ReportsClient from "./ReportsClient";
import { formatDateInput, formatDateKey, parseLocalDate } from "@/lib/date";
import { getUnits } from "@/app/actions/catalog";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
    searchParams,
}: {
    searchParams?: Promise<{ from?: string; to?: string }> | { from?: string; to?: string };
}) {
    const resolvedSearchParams = await Promise.resolve(searchParams);
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), 0, 1);
    const defaultTo = new Date(today.getFullYear(), 11, 31);

    const fromDate = parseLocalDate(resolvedSearchParams?.from) ?? defaultFrom;
    const toDate = parseLocalDate(resolvedSearchParams?.to) ?? defaultTo;

    const fromStart = new Date(fromDate);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(toDate);
    toEnd.setHours(23, 59, 59, 999);

    const currentUser = await getCurrentUser();
    const tenantId = currentUser!.tenantId!;

    const [entries, revenues, items, vendors, expenseTypes, units] = await Promise.all([
        prisma.entry.findMany({
            where: {
                tenantId,
                date: { gte: fromStart, lte: toEnd },
            },
            include: { item: true, vendor: true },
            orderBy: { date: "desc" },
        }),
        prisma.revenue.findMany({
            where: { tenantId, date: { gte: fromStart, lte: toEnd } },
            include: { location: true },
            orderBy: { date: "desc" },
        }),
        prisma.item.findMany({ where: { tenantId }, orderBy: { sortOrder: "asc" } }),
        prisma.vendor.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
        prisma.dictionary.findMany({
            where: { tenantId, category: "expense_type" },
            orderBy: { sortOrder: "asc" },
        }),
        getUnits(),
    ]);

    const expenseTypeMap = new Map(expenseTypes.map((item) => [item.value, item.label]));
    const itemOptions = items.map((item) => ({
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        defaultUnit: item.defaultUnit,
        isActive: item.isActive,
    }));
    const vendorOptions = vendors.map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        isActive: vendor.isActive,
    }));
    const expenseOptions = expenseTypes.map((item) => ({
        value: item.value,
        label: item.label,
    }));

    const dailyMap = new Map<string, { date: string; revenue: number; cost: number }>();
    const ensureDay = (key: string) => {
        if (!dailyMap.has(key)) {
            dailyMap.set(key, { date: key, revenue: 0, cost: 0 });
        }
        return dailyMap.get(key)!;
    };

    revenues.forEach((revenue) => {
        const key = formatDateKey(revenue.date);
        ensureDay(key).revenue += revenue.amount;
    });

    entries.forEach((entry) => {
        const key = formatDateKey(entry.date);
        ensureDay(key).cost += entry.totalPrice;
    });

    const dailyStats: { date: string; revenue: number; cost: number }[] = [];
    const cursor = new Date(fromStart);
    while (cursor <= toEnd) {
        const key = formatDateKey(cursor);
        dailyStats.push(dailyMap.get(key) ?? { date: key, revenue: 0, cost: 0 });
        cursor.setDate(cursor.getDate() + 1);
    }

    const totalRevenue = revenues.reduce((sum, record) => sum + record.amount, 0);
    const totalCost = entries.reduce((sum, record) => sum + record.totalPrice, 0);

    const topItemMap = new Map<
        string,
        { name: string; totalCost: number; totalWeightKg: number; totalQuantity: number; unit: string }
    >();
    entries
        .filter((entry) => entry.type === "PURCHASE" && entry.itemId)
        .forEach((entry) => {
            const key = entry.itemId as string;
            const current = topItemMap.get(key) ?? {
                name: entry.item?.name || "未命名",
                totalCost: 0,
                totalWeightKg: 0,
                totalQuantity: 0,
                unit: entry.inputUnit || "",
            };
            current.totalCost += entry.totalPrice;
            current.totalWeightKg += entry.standardWeight || 0;
            current.totalQuantity += entry.inputQuantity || 0;
            current.unit = entry.inputUnit || current.unit;
            topItemMap.set(key, current);
        });

    const topItems = Array.from(topItemMap.values())
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 8);

    const expenseMap = new Map<string, number>();
    entries
        .filter((entry) => entry.type === "EXPENSE" && entry.expenseType)
        .forEach((entry) => {
            const key = entry.expenseType as string;
            expenseMap.set(key, (expenseMap.get(key) || 0) + entry.totalPrice);
        });

    const expenseBreakdown = Array.from(expenseMap.entries())
        .map(([type, total]) => ({
            type,
            label: expenseTypeMap.get(type) || type,
            total,
        }))
        .sort((a, b) => b.total - a.total);

    const entryRecords = entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        date: formatDateInput(entry.date),
        itemId: entry.itemId || "",
        itemName: entry.item?.name || "",
        vendorId: entry.vendorId || "",
        vendorName: entry.vendor?.name || "",
        inputQuantity: entry.inputQuantity || 0,
        inputUnit: entry.inputUnit || "",
        totalPrice: entry.totalPrice,
        expenseType: entry.expenseType || "",
        note: entry.note || "",
    }));

    const revenueRecords = revenues.map((record) => ({
        id: record.id,
        date: formatDateInput(record.date),
        locationId: record.locationId,
        locationName: record.location?.name || "",
        amount: record.amount,
        isDayOff: record.isDayOff,
    }));

    return (
        <ReportsClient
            roleCode={currentUser?.roleCode ?? "read"}
            range={{ from: formatDateInput(fromStart), to: formatDateInput(toEnd) }}
            totals={{ revenue: totalRevenue, cost: totalCost, profit: totalRevenue - totalCost }}
            dailyStats={dailyStats}
            topItems={topItems}
            expenseBreakdown={expenseBreakdown}
            entries={entryRecords}
            revenues={revenueRecords}
            items={itemOptions}
            vendors={vendorOptions}
            expenseTypes={expenseOptions}
            units={units}
        />
    );
}
