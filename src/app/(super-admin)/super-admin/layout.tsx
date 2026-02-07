import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default async function SuperAdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const user = await getCurrentUser();

    if (!user) redirect("/login");
    if (!user.isSuperAdmin) redirect("/");

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground">
            <header className="border-b bg-background/80 backdrop-blur">
                <div className="p-4 max-w-4xl mx-auto w-full flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/super-admin" className="font-bold text-lg text-primary">
                            Super Admin
                        </Link>
                        <nav className="flex gap-2">
                            <Link href="/super-admin">
                                <Button variant="ghost" size="sm">儀表板</Button>
                            </Link>
                            <Link href="/super-admin/tenants">
                                <Button variant="ghost" size="sm">企業管理</Button>
                            </Link>
                        </nav>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{user.username}</span>
                        <form action={logout}>
                            <Button size="sm" variant="outline">登出</Button>
                        </form>
                    </div>
                </div>
            </header>
            <main className="flex-1 p-4 max-w-4xl mx-auto w-full">
                {children}
            </main>
        </div>
    );
}
