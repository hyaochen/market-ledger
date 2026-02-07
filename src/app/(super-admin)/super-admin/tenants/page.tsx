import { getTenants, toggleTenantStatus } from "@/app/actions/super-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, FileText, DollarSign } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
    const tenants = await getTenants();

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">企業管理</h1>
                    <p className="text-muted-foreground text-sm">管理所有企業帳戶</p>
                </div>
                <Link href="/super-admin/tenants/new">
                    <Button>新增企業</Button>
                </Link>
            </header>

            {tenants.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        尚無企業，請新增第一個企業。
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {tenants.map((tenant) => (
                        <Card key={tenant.id}>
                            <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
                                <div className="flex items-center gap-3">
                                    <Building2 className="h-5 w-5 text-primary" />
                                    <div>
                                        <CardTitle className="text-base">{tenant.name}</CardTitle>
                                        <span className="text-xs text-muted-foreground">{tenant.code}</span>
                                    </div>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded-full ${
                                            tenant.status
                                                ? "bg-green-100 text-green-700"
                                                : "bg-red-100 text-red-700"
                                        }`}
                                    >
                                        {tenant.status ? "啟用" : "停用"}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Link href={`/super-admin/tenants/${tenant.id}`}>
                                        <Button variant="outline" size="sm" className="text-xs h-7">
                                            詳情
                                        </Button>
                                    </Link>
                                    <form
                                        action={async () => {
                                            "use server";
                                            await toggleTenantStatus(tenant.id, !tenant.status);
                                        }}
                                    >
                                        <Button variant="outline" size="sm" className="text-xs h-7">
                                            {tenant.status ? "停用" : "啟用"}
                                        </Button>
                                    </form>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 pt-0">
                                <div className="flex gap-6 text-sm text-muted-foreground">
                                    <span className="flex items-center gap-1">
                                        <Users className="h-3.5 w-3.5" />
                                        {tenant._count.users} 用戶
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <FileText className="h-3.5 w-3.5" />
                                        {tenant._count.entries} 記錄
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <DollarSign className="h-3.5 w-3.5" />
                                        {tenant._count.revenues} 營收
                                    </span>
                                </div>
                                {tenant.note && (
                                    <div className="mt-2 text-xs text-muted-foreground">
                                        {tenant.note}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
