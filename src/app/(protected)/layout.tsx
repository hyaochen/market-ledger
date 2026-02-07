import MobileNav from "@/components/layout/MobileNav";
import { requireAuth } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await requireAuth();
    const displayName = user.realName || user.username;

    return (
        <div className="flex flex-col min-h-screen pb-20 bg-background text-foreground">
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
