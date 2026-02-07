import { getTenantById, updateTenant, toggleTenantStatus } from "@/app/actions/super-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Users, FileText, DollarSign, Package, Truck, MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
    params,
}: {
    params: Promise<{ id: string }> | { id: string };
}) {
    const resolvedParams = await Promise.resolve(params);
    const tenant = await getTenantById(resolvedParams.id);

    if (!tenant) notFound();

    const stats = [
        { icon: Users, label: "用戶", count: tenant._count.users },
        { icon: FileText, label: "進貨/支出", count: tenant._count.entries },
        { icon: DollarSign, label: "營收", count: tenant._count.revenues },
        { icon: Package, label: "品項", count: tenant._count.items },
        { icon: Truck, label: "廠商", count: tenant._count.vendors },
        { icon: MapPin, label: "場所", count: tenant._count.locations },
    ];

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold tracking-tight">{tenant.name}</h1>
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
                    <p className="text-muted-foreground text-sm">代碼：{tenant.code}</p>
                </div>
                <div className="flex gap-2">
                    <form
                        action={async () => {
                            "use server";
                            await toggleTenantStatus(tenant.id, !tenant.status);
                        }}
                    >
                        <Button variant="outline" size="sm">
                            {tenant.status ? "停用企業" : "啟用企業"}
                        </Button>
                    </form>
                    <Link href="/super-admin/tenants">
                        <Button variant="ghost" size="sm">返回列表</Button>
                    </Link>
                </div>
            </header>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {stats.map((s) => (
                    <Card key={s.label}>
                        <CardContent className="p-4 flex items-center gap-3">
                            <s.icon className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-lg font-bold">{s.count}</div>
                                <div className="text-xs text-muted-foreground">{s.label}</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">編輯企業資訊</CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        action={async (formData: FormData) => {
                            "use server";
                            await updateTenant(tenant.id, formData);
                        }}
                        className="space-y-4"
                    >
                        <div className="space-y-2">
                            <Label>企業名稱</Label>
                            <Input name="name" defaultValue={tenant.name} required />
                        </div>
                        <div className="space-y-2">
                            <Label>備註</Label>
                            <Input name="note" defaultValue={tenant.note || ""} />
                        </div>
                        <Button type="submit">儲存變更</Button>
                    </form>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">用戶列表</CardTitle>
                </CardHeader>
                <CardContent>
                    {tenant.users.length === 0 ? (
                        <div className="text-sm text-muted-foreground">此企業尚無用戶</div>
                    ) : (
                        <div className="space-y-2">
                            {tenant.users.map((u) => (
                                <div
                                    key={u.id}
                                    className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50"
                                >
                                    <div>
                                        <span className="text-sm font-medium">{u.realName || u.username}</span>
                                        <span className="text-xs text-muted-foreground ml-2">@{u.username}</span>
                                    </div>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded-full ${
                                            u.status
                                                ? "bg-green-100 text-green-700"
                                                : "bg-red-100 text-red-700"
                                        }`}
                                    >
                                        {u.status ? "啟用" : "停用"}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
