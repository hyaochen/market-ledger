import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import prisma from "@/lib/prisma";
import { formatPrice, getUnitLabel } from "@/lib/units";
import { getUnits } from "@/app/actions/catalog";

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export default async function InventoryPage({
    searchParams,
}: {
    searchParams?: Promise<{ category?: string }> | { category?: string };
}) {
    const resolvedSearchParams = await Promise.resolve(searchParams);
    const categoryFilter = resolvedSearchParams?.category || 'all';
    const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    const units = await getUnits();

    // 獲取最近 50 筆進貨
    const entries = await prisma.entry.findMany({
        where: {
            type: 'PURCHASE',
            ...(categoryFilter !== 'all'
                ? { item: { categoryId: categoryFilter } }
                : {})
        },
        include: {
            item: true,
            vendor: true
        },
        orderBy: {
            date: 'desc'
        },
        take: 50
    });

    return (
        <div className="space-y-6 pb-20 animate-in fade-in zoom-in duration-500">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">進貨記錄</h1>
                    <p className="text-muted-foreground text-sm">最近 {entries.length} 筆採購</p>
                </div>
                <Link href="/entry/new">
                    <Button size="sm" className="gap-1">
                        <PlusCircle className="h-4 w-4" />
                        新增
                    </Button>
                </Link>
            </header>

            {/* 篩選器 */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                <Link href="/inventory">
                    <Button variant={categoryFilter === 'all' ? "outline" : "ghost"} size="sm" className="rounded-full">
                        全部
                    </Button>
                </Link>
                {categories.map((category) => (
                    <Link key={category.id} href={`/inventory?category=${category.id}`}>
                        <Button
                            variant={categoryFilter === category.id ? "outline" : "ghost"}
                            size="sm"
                            className="rounded-full"
                        >
                            {category.name}
                        </Button>
                    </Link>
                ))}
            </div>

            {/* 列表內容 */}
            <div className="space-y-4">
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
                    entries.map(entry => (
                        <Card key={entry.id} className="overflow-hidden">
                            <div className="flex border-l-4 border-primary">
                                <div className="flex-1 p-4">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-semibold text-base">{entry.item?.name || '未知品項'}</h3>
                                        <span className="font-bold text-primary">{formatPrice(entry.totalPrice)}</span>
                                    </div>

                                    <div className="flex justify-between text-sm text-muted-foreground">
                                        <span>
                                            {entry.inputQuantity ?? 0} {getUnitLabel(entry.inputUnit || '', units)}
                                        </span>
                                        <span>{new Date(entry.date).toLocaleDateString('zh-TW')}</span>
                                    </div>

                                    {entry.vendor && (
                                        <div className="mt-2 text-xs text-muted-foreground bg-muted inline-block px-2 py-1 rounded">
                                            {entry.vendor.name}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
