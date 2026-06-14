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
        <div className="p-4 space-y-3">
            <h1 className="text-lg font-bold">📋 動作清單管理</h1>
            <ChecklistAdminClient items={items.map((i) => ({
                id: i.id,
                name: i.name,
                sortOrder: i.sortOrder,
                isActive: i.isActive,
            }))} />
        </div>
    );
}
