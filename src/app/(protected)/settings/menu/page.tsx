import { getPermissions } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LayoutGrid } from "lucide-react";
import MenuForm from "./MenuForm";

export default async function MenuPage() {
    const permissions = await getPermissions();

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">功能表管理</h1>
                    <p className="text-muted-foreground text-sm">配置系統菜單與權限標識</p>
                </div>
                <MenuForm permissions={permissions} />
            </header>

            <Card>
                <CardContent className="p-0">
                    <div className="divide-y text-sm">
                        {permissions.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">尚未定義任何功能表</div>
                        ) : (
                            permissions.map((perm: any) => (
                                <div key={perm.id} className="p-4 hover:bg-muted/50">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/10 p-2 rounded">
                                                <LayoutGrid className="h-4 w-4 text-primary" />
                                            </div>
                                            <div>
                                                <div className="font-semibold">{perm.name}</div>
                                                <div className="text-xs text-muted-foreground flex gap-2">
                                                    <span>代碼: {perm.code}</span>
                                                    <span>|</span>
                                                    <span>類型: {perm.type}</span>
                                                </div>
                                            </div>
                                        </div>
                                        {perm.path && <div className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{perm.path}</div>}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
