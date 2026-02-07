import { getSuperAdminStats } from "@/app/actions/super-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Users, FileText, DollarSign } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function SuperAdminDashboard() {
    const stats = await getSuperAdminStats();

    if (!stats) return null;

    const cards = [
        { icon: Building2, label: "企業數量", value: stats.tenantCount, href: "/super-admin/tenants" },
        { icon: Users, label: "總用戶數", value: stats.userCount },
        { icon: FileText, label: "總進貨/支出", value: stats.entryCount },
        { icon: DollarSign, label: "總營收記錄", value: stats.revenueCount },
    ];

    return (
        <div className="space-y-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">超級管理後台</h1>
                    <p className="text-muted-foreground text-sm">管理所有企業與系統狀態</p>
                </div>
                <Link href="/super-admin/tenants/new">
                    <Button>新增企業</Button>
                </Link>
            </header>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((card) => (
                    <Card key={card.label}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm text-muted-foreground">{card.label}</CardTitle>
                            <card.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            {card.href ? (
                                <Link href={card.href} className="text-2xl font-bold hover:text-primary transition-colors">
                                    {card.value}
                                </Link>
                            ) : (
                                <div className="text-2xl font-bold">{card.value}</div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
