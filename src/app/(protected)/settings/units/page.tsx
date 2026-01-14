import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Scale } from "lucide-react";
import UnitForm from "./UnitForm";
import { parseUnitMeta } from "@/lib/units";
import { toggleDictionaryStatus } from "@/app/actions/catalog";

export default async function UnitsPage() {
    const unitRows = await prisma.dictionary.findMany({
        where: { category: "unit" },
        orderBy: { sortOrder: "asc" },
    });

    return (
        <div className="space-y-6 pb-20">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">單位管理</h1>
                    <p className="text-muted-foreground text-sm">設定秤重或件數單位與換算值。</p>
                </div>
                <UnitForm />
            </header>

            <div className="space-y-4">
                {unitRows.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            尚無單位資料，請先新增。
                        </CardContent>
                    </Card>
                ) : (
                    unitRows.map((unit) => {
                        const meta = parseUnitMeta(unit.meta);
                        return (
                            <Card key={unit.id}>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Scale className="h-5 w-5 text-primary" />
                                        <CardTitle className="text-base">{unit.label}</CardTitle>
                                    </div>
                                    <span
                                        className={`text-xs px-2 py-1 rounded-full ${unit.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                    >
                                        {unit.isActive ? "啟用" : "停用"}
                                    </span>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm text-muted-foreground">
                                    <div>代碼：{unit.value}</div>
                                    <div>
                                        類型：{meta.isWeight ? "秤重單位" : "件數單位"}
                                    </div>
                                    {meta.isWeight && meta.toKg && (
                                        <div>換算：1 單位 = {meta.toKg} 公斤</div>
                                    )}
                                    <form
                                        action={async () => {
                                            "use server";
                                            await toggleDictionaryStatus(unit.id, !unit.isActive);
                                        }}
                                    >
                                        <Button size="sm" variant="outline" className="mt-2">
                                            {unit.isActive ? "停用" : "啟用"}
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}
