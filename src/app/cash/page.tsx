import { requireCashAuth } from "@/lib/cash-auth";
import prisma from "@/lib/prisma";
import { listActiveChecklistItems } from "@/app/actions/cash";
import CashCountForm from "@/components/cash/CashCountForm";
import { todayLocalIsoDate } from "@/lib/cash-ui";
import { submissionLookupWhere, toSubmissionNotice } from "@/lib/cash-queries";

export default async function CashEntryPage() {
    const user = await requireCashAuth();
    const today = todayLocalIsoDate();

    let locationName = "屏東攤位";
    if (user.locationId) {
        const loc = await prisma.location.findUnique({ where: { id: user.locationId }, select: { name: true } });
        if (loc) locationName = loc.name;
    }

    // T-ML-034 C1：今天這個攤位是不是已經提交過。
    // 只是唯讀地查一次來提醒使用者「再提交會覆蓋」：不預填舊資料、不改提交語意。
    // 日期用 submissionLookupWhere（與 submitCashCount 同一套 parseLocalDate），避免時區差一天。
    let existing = null;
    if (user.locationId) {
        const where = submissionLookupWhere({ tenantId: user.tenantId, locationId: user.locationId, today });
        if (where) {
            const row = await prisma.cashCount.findFirst({
                where,
                select: {
                    id: true,
                    handoverTime: true,
                    attendant: { select: { realName: true, username: true } },
                },
            });
            if (row) existing = toSubmissionNotice(row);
        }
    }

    const checklistItems = await listActiveChecklistItems();

    return (
        <CashCountForm
            today={today}
            attendantId={user.id}
            attendantName={user.displayName}
            locationName={locationName}
            checklistItems={checklistItems.map((c) => ({ id: c.id, name: c.name }))}
            existing={existing}
        />
    );
}
