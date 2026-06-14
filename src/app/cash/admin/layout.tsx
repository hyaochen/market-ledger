import Link from "next/link";
import { requireCashAdmin } from "@/lib/cash-auth";

export default async function CashAdminLayout({ children }: { children: React.ReactNode }) {
    await requireCashAdmin();
    return (
        <div className="space-y-2">
            <nav className="flex items-center gap-3 px-4 pt-3 text-xs">
                <Link href="/cash/admin/checklist" className="text-amber-700 underline">動作清單</Link>
                <Link href="/cash/admin/alerts" className="text-amber-700 underline">異常</Link>
                <Link href="/cash/stats" className="text-amber-700 underline">分析</Link>
            </nav>
            {children}
        </div>
    );
}
