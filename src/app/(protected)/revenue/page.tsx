import prisma from "@/lib/prisma";
import RevenueForm from "./RevenueForm";
import { requireRole } from "@/lib/auth";

export default async function RevenuePage() {
    const currentUser = await requireRole("write");
    const tenantId = currentUser.tenantId!;
    const locations = await prisma.location.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'asc' }
    });

    return (
        <div className="space-y-6 pb-20">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">每日營收</h1>
                <p className="text-muted-foreground text-sm">記錄各據點營業額</p>
            </header>

            <RevenueForm locations={locations} />
        </div>
    );
}
