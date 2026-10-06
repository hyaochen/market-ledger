import { requireCashAdmin } from "@/lib/cash-auth";
import AdminSubNav from "@/components/cash/AdminSubNav";

export default async function CashAdminLayout({ children }: { children: React.ReactNode }) {
    await requireCashAdmin();
    return (
        <div className="space-y-2">
            <div className="px-4 pt-4">
                <AdminSubNav />
            </div>
            {children}
        </div>
    );
}
