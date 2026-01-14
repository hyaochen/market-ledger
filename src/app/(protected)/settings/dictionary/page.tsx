import { getDictionary, deleteDictionaryItem } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookMarked, Trash2 } from "lucide-react";
import DictForm from "./DictForm";

export default async function DictionaryPage() {
    const dictItems = await getDictionary();

    // Group by category
    const groupedItems = dictItems.reduce((acc: any, item: any) => {
        if (!acc[item.category]) {
            acc[item.category] = [];
        }
        acc[item.category].push(item);
        return acc;
    }, {});

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">字典管理</h1>
                    <p className="text-muted-foreground text-sm">維護系統常數與枚舉資料</p>
                </div>
                <DictForm />
            </header>

            <div className="space-y-6">
                {Object.keys(groupedItems).length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">尚未定義任何字典資料</CardContent>
                    </Card>
                ) : (
                    Object.entries(groupedItems).map(([category, items]: [string, any]) => (
                        <Card key={category}>
                            <CardHeader className="bg-muted/30 py-3">
                                <CardTitle className="text-sm font-bold flex items-center gap-2">
                                    <BookMarked className="h-4 w-4 text-primary" />
                                    類別: {category}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="divide-y text-sm">
                                    {items.map((item: any) => (
                                        <div key={item.id} className="flex items-center justify-between p-3 hover:bg-accent/50">
                                            <div className="flex-1">
                                                <span className="font-semibold">{item.label}</span>
                                                <span className="mx-2 text-muted-foreground">/</span>
                                                <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{item.value}</code>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
                                                序: {item.sortOrder}
                                            </div>
                                            <form action={async () => {
                                                'use server';
                                                await deleteDictionaryItem(item.id);
                                            }}>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </form>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
