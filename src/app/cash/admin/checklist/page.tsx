import prisma from "@/lib/prisma";
import { requireCashAdmin } from "@/lib/cash-auth";
import ChecklistAdminClient from "./ChecklistAdminClient";

export default async function ChecklistAdminPage() {
    const user = await requireCashAdmin();
    const items = await prisma.checklistItem.findMany({
        where: { tenantId: user.tenantId },
        orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return (
        <div className="space-y-4 px-4 pb-4 pt-2 md:pt-4">
            <header>
                <h1 className="text-2xl font-bold text-stone-900">動作清單管理</h1>
                <p className="mt-0.5 text-[15px] text-stone-600">員工收攤時要逐項打勾的動作。數字小的排在前面。</p>
            </header>
            <ChecklistAdminClient items={items.map((i) => ({
                id: i.id,
                name: i.name,
                sortOrder: i.sortOrder,
                isActive: i.isActive,
            }))} />
        </div>
    );
}
