import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import CashLoginForm from "./CashLoginForm";

export default async function CashLoginPage() {
    const user = await getCurrentUser();
    if (user && user.tenantId) redirect("/cash");

    return (
        <div className="min-h-[100dvh] flex items-center justify-center px-6 bg-amber-50">
            <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-6 border border-amber-200">
                <h1 className="text-xl font-bold text-center mb-1 text-amber-700">市場現金清點</h1>
                <p className="text-xs text-center text-zinc-500 mb-6">員工登入</p>
                <CashLoginForm />
            </div>
        </div>
    );
}
