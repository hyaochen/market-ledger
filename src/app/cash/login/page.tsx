import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CashLogo from "@/components/cash/CashLogo";
import { CARD } from "@/components/cash/ui";
import { cn } from "@/lib/utils";
import CashLoginForm from "./CashLoginForm";

export default async function CashLoginPage() {
    const user = await getCurrentUser();
    if (user && user.tenantId) redirect("/cash");

    return (
        <main className="flex min-h-[100dvh] flex-col items-center justify-center px-5 py-10">
            <div className="w-full max-w-sm">
                <div className="mb-8 flex flex-col items-center text-center">
                    <CashLogo className="h-16 w-16" />
                    <h1 className="mt-4 text-2xl font-bold text-stone-900">市場現金清點</h1>
                    <p className="mt-1 text-base text-stone-600">員工登入</p>
                </div>

                <div className={cn(CARD, "p-5 sm:p-6")}>
                    <CashLoginForm />
                </div>

                <p className="mt-6 text-center text-[15px] text-stone-600">
                    忘記帳號或密碼，請洽管理者
                </p>
            </div>
        </main>
    );
}
