import { requireCashAuth } from "@/lib/cash-auth";
import prisma from "@/lib/prisma";
import { listActiveChecklistItems } from "@/app/actions/cash";
import CashCountForm from "@/components/cash/CashCountForm";

function todayLocalIsoDate(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export default async function CashEntryPage() {
    const user = await requireCashAuth();
    const today = todayLocalIsoDate();

    let locationName = "屏東攤位";
    if (user.locationId) {
        const loc = await prisma.location.findUnique({ where: { id: user.locationId }, select: { name: true } });
        if (loc) locationName = loc.name;
    }

    const checklistItems = await listActiveChecklistItems();

    return (
        <CashCountForm
            today={today}
            attendantName={user.displayName}
            locationName={locationName}
            checklistItems={checklistItems.map((c) => ({ id: c.id, name: c.name }))}
        />
    );
}
