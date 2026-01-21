import { getCommonData } from "@/app/actions/common";
import EntryForm from "./EntryForm";
import prisma from "@/lib/prisma";
import { getUnits } from "@/app/actions/catalog";
import { requireRole } from "@/lib/auth";

export default async function NewEntryPage() {
    await requireRole("write");
    const { categories, items, vendors } = await getCommonData();
    const units = await getUnits();

    // 獲取支出類型字典
    const expenseTypes = await prisma.dictionary.findMany({
        where: { category: 'expense_type', isActive: true },
        orderBy: { sortOrder: 'asc' }
    });

    // 獲取常用記錄模板
    const templates = await prisma.entryTemplate.findMany({
        where: { userId: (await requireRole('read')).user.id },
        orderBy: { sortOrder: 'asc' }
    });

    return (
        <div className="space-y-6 pb-20">
            <header>
                <h1 className="text-2xl font-bold">新增記錄</h1>
                <p className="text-muted-foreground text-sm">記錄新的進貨或支出</p>
            </header>

            <EntryForm
                categories={categories}
                items={items}
                vendors={vendors}
                expenseTypes={expenseTypes}
                units={units}
                templates={templates}
            />
        </div>
    );
}
