import { getCommonData } from "@/app/actions/common";
import EntryForm from "./EntryForm";
import prisma from "@/lib/prisma";
import { getUnits } from "@/app/actions/catalog";
import { requireRole, getTenantId } from "@/lib/auth";

export default async function NewEntryPage() {
    const currentUser = await requireRole("write");
    const tenantId = await getTenantId();
    const { categories, items, vendors } = await getCommonData();
    const units = await getUnits();

    const [expenseTypes, templates] = await Promise.all([
        prisma.dictionary.findMany({
            where: { category: 'expense_type', isActive: true, tenantId },
            orderBy: { sortOrder: 'asc' },
        }),
        prisma.entryTemplate.findMany({
            where: { userId: currentUser.id },
            orderBy: { sortOrder: 'asc' },
        }),
    ]);

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
