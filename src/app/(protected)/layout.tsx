import MobileNav from "@/components/layout/MobileNav";
import { requireAuth } from "@/lib/auth";
import { logout, switchBackToSuperAdmin } from "@/app/actions/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await requireAuth();
    const displayName = user.realName || user.username;
    const isSuperAdminInTenant = user.isSuperAdmin && !!user.tenantId;

    return (
        <div className="flex flex-col min-h-screen pb-20 bg-background text-foreground">
            {isSuperAdminInTenant && (
                <div className="bg-primary text-primary-foreground text-center py-1.5 text-xs font-medium flex items-center justify-center gap-2">
                    <span>目前以超級管理者身份檢視「{user.tenantName}」</span>
                    <form
                        action={async () => {
                            "use server";
                            const res = await switchBackToSuperAdmin();
                            if (res.success) redirect("/super-admin");
                        }}
                    >
                        <button type="submit" className="inline-flex items-center gap-1 underline hover:opacity-80">
                            <ArrowLeft className="h-3 w-3" />
                            返回超級管理
                        </button>
                    </form>
                </div>
            )}
            <header className="border-b bg-background/80 backdrop-blur">
                <div className="p-4 max-w-md mx-auto w-full md:max-w-2xl lg:max-w-4xl flex items-center justify-between">
                    <div>
                        {user.tenantName && (
                            <div className="text-xs font-semibold text-primary">{user.tenantName}</div>
                        )}
                        <div className="text-sm font-medium">{displayName}</div>
                    </div>
                    <form action={logout}>
                        <Button size="sm" variant="outline">登出</Button>
                    </form>
                </div>
            </header>
            <main className="flex-1 p-4 max-w-md mx-auto w-full md:max-w-2xl lg:max-w-4xl">
                {children}
            </main>
            <MobileNav role={user.roleCode} />
        </div>
    );
}
