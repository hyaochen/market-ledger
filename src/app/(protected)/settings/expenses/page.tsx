import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import ExpenseForm from "./ExpenseForm";
import { toggleDictionaryStatus } from "@/app/actions/catalog";
import { getTenantId } from "@/lib/auth";

export default async function ExpensesPage() {
    const tenantId = await getTenantId();
    const expenseTypes = await prisma.dictionary.findMany({
        where: { tenantId, category: "expense_type" },
        orderBy: { sortOrder: "asc" },
    });

    return (
        <div className="space-y-6 pb-20">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">支出項目</h1>
                    <p className="text-muted-foreground text-sm">管理租金、水電、瓦斯等常用項目。</p>
                </div>
                <ExpenseForm />
            </header>

            <div className="space-y-4">
                {expenseTypes.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            尚無支出項目，請先新增。
                        </CardContent>
                    </Card>
                ) : (
                    expenseTypes.map((item) => (
                        <Card key={item.id}>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Receipt className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-base">{item.label}</CardTitle>
                                </div>
                                <span
                                    className={`text-xs px-2 py-1 rounded-full ${item.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                >
                                    {item.isActive ? "啟用" : "停用"}
                                </span>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm text-muted-foreground">
                                <form
                                    action={async () => {
                                        "use server";
                                        await toggleDictionaryStatus(item.id, !item.isActive);
                                    }}
                                >
                                    <Button size="sm" variant="outline" className="mt-2">
                                        {item.isActive ? "停用" : "啟用"}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
