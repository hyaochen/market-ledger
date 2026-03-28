import { Card, CardContent } from "@/components/ui/card";
import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import prisma from "@/lib/prisma";
import { formatPrice, formatQuantityDisplay } from "@/lib/units";
import { getUnits } from "@/app/actions/catalog";
import { getCurrentUser } from "@/lib/auth";
import InventoryEntryActions from "./InventoryEntryActions";
import ScrollToTop from "./ScrollToTop";

export const dynamic = 'force-dynamic';

export default async function InventoryPage({
    searchParams,
}: {
    searchParams?: Promise<{ category?: string }> | { category?: string };
}) {
    const resolvedSearchParams = await Promise.resolve(searchParams);
    const categoryFilter = resolvedSearchParams?.category || 'all';
    const user = await getCurrentUser();
    const tenantId = user!.tenantId!;
    const canEdit = user?.roleCode === "write" || user?.roleCode === "admin";

    const [categories, units, items, vendors, expenseTypes] = await Promise.all([
        prisma.category.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }),
        getUnits(),
        prisma.item.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.vendor.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.dictionary.findMany({
            where: { tenantId, category: "expense_type", isActive: true },
            orderBy: { sortOrder: "asc" },
        }),
    ]);

    const expenseTypeMap = new Map(expenseTypes.map((item) => [item.value, item.label]));
    const EXPENSE_FILTER = "expense";

    const entries = await prisma.entry.findMany({
        where: {
            tenantId,
            ...(categoryFilter === EXPENSE_FILTER
                ? { type: 'EXPENSE' }
                : categoryFilter !== 'all'
                    ? { type: 'PURCHASE', item: { categoryId: categoryFilter } }
                    : {})
        },
        include: {
            item: { include: { category: true } },
            vendor: true,
            user: true,
        },
        orderBy: { date: 'desc' },
        take: 50,
    });

    return (
        <div className="space-y-5 pb-20 animate-in fade-in zoom-in duration-500">
            <ScrollToTop id={categoryFilter} />

            {/* Header */}
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">進貨記錄</h1>
                    <p className="text-muted-foreground text-sm mt-0.5">最近 {entries.length} 筆記錄</p>
                </div>
                <Link href="/entry/new">
                    <Button size="sm" className="gap-1">
                        <PlusCircle className="h-4 w-4" />
                        新增
                    </Button>
                </Link>
            </header>

            {/* Category Filter - Pill Style */}
            <div className="sticky top-[61px] z-30 bg-background -mx-4 px-4 py-2.5 flex gap-2 overflow-x-auto border-b shadow-sm">
                <Link href="/inventory">
                    <button className={[
                        "px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-95",
                        categoryFilter === 'all'
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-accent/40 hover:bg-accent/70 text-foreground"
                    ].join(" ")}>
                        全部
                    </button>
                </Link>
                {categories.map((category) => (
                    <Link key={category.id} href={`/inventory?category=${category.id}`}>
                        <button className={[
                            "px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-95",
                            categoryFilter === category.id
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "bg-accent/40 hover:bg-accent/70 text-foreground"
                        ].join(" ")}>
                            {category.name}
                        </button>
                    </Link>
                ))}
                <Link href={`/inventory?category=${EXPENSE_FILTER}`}>
                    <button className={[
                        "px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all active:scale-95",
                        categoryFilter === EXPENSE_FILTER
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-accent/40 hover:bg-accent/70 text-foreground"
                    ].join(" ")}>
                        其他支出
                    </button>
                </Link>
            </div>

            {/* Entry List - Compact Card Style (matching Reports) */}
            <div className="space-y-2">
                {entries.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground space-y-4">
                            <div className="bg-muted/50 p-4 rounded-full">
                                <PlusCircle className="h-8 w-8 opacity-50" />
                            </div>
                            <div>
                                <p className="font-medium">尚無進貨記錄</p>
                                <p className="text-sm">點擊右上角新增第一筆資料</p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    entries.map((entry) => (
                        <Card key={entry.id} className="hover:shadow-sm transition-shadow">
                            <CardContent className="flex items-center gap-3 p-3 sm:p-4">
                                {/* Type Badge */}
                                <div className={[
                                    "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold",
                                    entry.type === "PURCHASE"
                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                ].join(" ")}>
                                    {entry.type === "PURCHASE" ? "進" : "支"}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <span className="font-semibold truncate">
                                            {entry.type === "PURCHASE"
                                                ? entry.item?.name || '未知品項'
                                                : expenseTypeMap.get(entry.expenseType || "") || entry.expenseType || "其他支出"}
                                        </span>
                                        <span className="font-bold text-primary whitespace-nowrap">
                                            {formatPrice(entry.totalPrice)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                                        <span>{new Date(entry.date).toLocaleDateString('zh-TW')}</span>
                                        {entry.type === "PURCHASE" && (
                                            <>
                                                <span>·</span>
                                                <span>{formatQuantityDisplay(entry.inputQuantity, entry.inputUnit)}</span>
                                                {entry.item?.category?.name && (
                                                    <>
                                                        <span>·</span>
                                                        <span>{entry.item.category.name}</span>
                                                    </>
                                                )}
                                                {entry.vendor && (
                                                    <>
                                                        <span>·</span>
                                                        <span>{entry.vendor.name}</span>
                                                    </>
                                                )}
                                            </>
                                        )}
                                        {entry.note && (
                                            <>
                                                <span>·</span>
                                                <span className="truncate">{entry.note}</span>
                                            </>
                                        )}
                                        <span>·</span>
                                        <span>{entry.user?.realName || entry.user?.username || "未知"}</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                {canEdit && (
                                    <div className="flex-shrink-0">
                                        <InventoryEntryActions
                                            entry={{
                                                id: entry.id,
                                                date: entry.date.toISOString(),
                                                type: entry.type,
                                                itemId: entry.itemId,
                                                vendorId: entry.vendorId,
                                                inputQuantity: entry.inputQuantity,
                                                inputUnit: entry.inputUnit,
                                                totalPrice: entry.totalPrice,
                                                note: entry.note,
                                                expenseType: entry.expenseType,
                                            }}
                                            items={items}
                                            vendors={vendors}
                                            expenseTypes={expenseTypes}
                                            units={units}
                                        />
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
