import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    ChevronRight,
    Database,
    Package,
    Scale,
    Store,
    Truck,
    User,
    FileClock,
    Shield,
    MapPin,
    LayoutGrid,
    GitPullRequest,
    Activity,
    Receipt
} from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
    const quickItems = [
        { icon: Package, label: "品項管理", desc: "肉類/菜類等品項設定", href: "/settings/items" },
        { icon: Truck, label: "廠商管理", desc: "供應商資訊維護", href: "/settings/vendors" },
        { icon: Scale, label: "單位管理", desc: "公斤/臺斤與特殊單位", href: "/settings/units" },
        { icon: Receipt, label: "支出項目", desc: "租金、水電等固定項目", href: "/settings/expenses" },
    ];

    const adminItems = [
        { icon: User, label: "使用者管理", desc: "帳號與所屬部門", href: "/settings/users" },
        { icon: Shield, label: "角色管理", desc: "讀取/編輯/管理三種權限", href: "/settings/roles" },
        { icon: Store, label: "機構管理", desc: "公司部門組織架構", href: "/settings/department" },
    ];

    const advancedItems = [
        { icon: LayoutGrid, label: "功能表管理", desc: "系統菜單與權限標識", href: "/settings/menu" },
        { icon: MapPin, label: "區域管理", desc: "行政區域資料", href: "/settings/region" },
        { icon: Database, label: "字典管理", desc: "進階常數與枚舉設定", href: "/settings/dictionary" },
        { icon: GitPullRequest, label: "工作流審核", desc: "單據審批流程", href: "/settings/workflow" },
        { icon: FileClock, label: "操作日誌", desc: "系統操作記錄", href: "/settings/logs" },
        { icon: Activity, label: "系統監測", desc: "資料庫與伺服器狀態", href: "/settings/monitor" },
    ];

    const renderSection = (title: string, items: any[]) => (
        <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground ml-1 uppercase tracking-wider">{title}</h2>
            <div className="space-y-2">
                {items.map((item, index) => (
                    <Link href={item.href} key={index} className="block">
                        <Card className="hover:bg-accent/50 transition-colors cursor-pointer active:scale-[0.98]">
                            <CardContent className="p-4 flex items-center gap-4">
                                <div className="p-2 bg-primary/10 rounded-full text-primary">
                                    <item.icon className="h-5 w-5" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-medium text-base">{item.label}</h3>
                                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    );

    return (
        <div className="space-y-8 pb-24 animate-in fade-in slide-in-from-bottom-5 duration-500">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">系統管理</h1>
                <p className="text-muted-foreground text-sm">設定與監控您的業務系統</p>
            </header>

            <div className="space-y-8">
                {renderSection("常用設定", quickItems)}
                {renderSection("帳號與權限", adminItems)}
                {renderSection("進階功能", advancedItems)}

                <div className="pt-4 px-1">
                    <Link href="/">
                        <Button variant="outline" className="w-full h-12 text-base font-semibold">
                            返回首頁
                        </Button>
                    </Link>
                    <div className="mt-4 text-center">
                        <p className="text-xs text-muted-foreground">Premium Enterprise v1.2.0</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
