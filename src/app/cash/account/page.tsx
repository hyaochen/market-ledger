import { Share } from "lucide-react";
import prisma from "@/lib/prisma";
import { requireCashAuth } from "@/lib/cash-auth";
import { formatDateWithWeekday, roleLabel, todayLocalIsoDate } from "@/lib/cash-ui";
import CashLogoutButton from "@/components/cash/CashLogoutButton";
import { CARD, chip } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

/**
 * 帳號頁（T-ML-034 A3）：員工與管理者都可以進。
 * 讓使用者隨時看得到「我現在是誰、記在哪個攤位」，並且有一顆大的登出鍵。
 */
export default async function CashAccountPage() {
    const user = await requireCashAuth();

    let locationName = "未指派攤位";
    if (user.locationId) {
        const loc = await prisma.location.findUnique({ where: { id: user.locationId }, select: { name: true } });
        if (loc) locationName = loc.name;
    }

    const rows: { label: string; value: React.ReactNode }[] = [
        { label: "顯示名稱", value: user.displayName },
        { label: "帳號", value: user.username },
        { label: "身分", value: <span className={chip("muted")}>{roleLabel(user.isAdmin)}</span> },
        { label: "所屬攤位", value: <span className={chip("warn", "text-base")}>{locationName}</span> },
        { label: "今天日期", value: formatDateWithWeekday(todayLocalIsoDate()) },
    ];

    return (
        <div className="space-y-5 px-4 pt-4 pb-4 md:pt-6">
            <h1 className="text-2xl font-bold text-stone-900">帳號</h1>

            <section aria-label="目前登入的帳號" className={CARD}>
                <dl className="divide-y divide-stone-200">
                    {rows.map((row) => (
                        <div key={row.label} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
                            <dt className="shrink-0 text-base text-stone-600">{row.label}</dt>
                            <dd className="min-w-0 break-all text-right text-lg font-bold text-stone-900">{row.value}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            <CashLogoutButton variant="block" />

            <section aria-labelledby="add-to-home" className={cn(CARD, "p-4 sm:p-5")}>
                <h2 id="add-to-home" className="text-lg font-bold text-stone-900">加到 iPhone 主畫面</h2>
                <p className="mt-1 text-base text-stone-700">
                    加好之後，從主畫面點圖示就能直接打開，不用每次輸入網址。
                </p>
                <ol className="mt-4 space-y-3">
                    {[
                        <>用 Safari 打開這個網頁（不要在 LINE 裡面開）。</>,
                        <>
                            點畫面下方的「分享」按鈕，圖示是方框加向上的箭頭
                            <Share className="ml-1 inline h-5 w-5 align-text-bottom text-stone-700" aria-hidden="true" />。
                        </>,
                        <>往下滑，點「加入主畫面」，再點右上角的「新增」。</>,
                    ].map((step, i) => (
                        <li key={i} className="flex items-start gap-3 text-base leading-relaxed text-stone-900">
                            <span
                                aria-hidden="true"
                                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-700 text-sm font-bold text-white"
                            >
                                {i + 1}
                            </span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}
