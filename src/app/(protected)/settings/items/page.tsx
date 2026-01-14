import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, Tag } from "lucide-react";
import CategoryForm from "./CategoryForm";
import ItemForm from "./ItemForm";
import { getUnits, toggleItemStatus } from "@/app/actions/catalog";
import { getUnitLabel } from "@/lib/units";
import ItemActions from "./ItemActions";
import CategoryActions from "./CategoryActions";

export default async function ItemsPage() {
    const categories = await prisma.category.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
            items: { orderBy: { sortOrder: "asc" } },
        },
    });
    const units = await getUnits();

    return (
        <div className="space-y-6 pb-20">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">品項管理</h1>
                    <p className="text-muted-foreground text-sm">設定分類、品項與預設單位。</p>
                </div>
                <div className="flex gap-2">
                    <CategoryForm />
                    <ItemForm categories={categories} units={units} />
                </div>
            </header>

            <div className="space-y-4">
                {categories.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            尚無任何類別，請先新增類別。
                        </CardContent>
                    </Card>
                ) : (
                    categories.map((category) => (
                        <Card key={category.id}>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Tag className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-base">{category.name}</CardTitle>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-muted-foreground">
                                        {category.items.length} 項
                                    </span>
                                    <CategoryActions categoryId={category.id} />
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {category.items.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">
                                        此類別尚無品項。
                                    </div>
                                ) : (
                                    category.items.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Package className="h-4 w-4 text-primary" />
                                                <div>
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        預設單位：{getUnitLabel(item.defaultUnit, units)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`text-xs px-2 py-1 rounded-full ${item.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                                >
                                                    {item.isActive ? "啟用" : "停用"}
                                                </span>
                                                <form
                                                    action={async () => {
                                                        "use server";
                                                        await toggleItemStatus(item.id, !item.isActive);
                                                    }}
                                                >
                                                    <Button size="sm" variant="outline">
                                                        {item.isActive ? "停用" : "啟用"}
                                                    </Button>
                                                </form>
                                                <ItemActions item={item} categories={categories} units={units} />
                                            </div>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
