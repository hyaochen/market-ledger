import { getRoles, syncDefaultRoles } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

export default async function RolesPage() {
    const roles = await getRoles();

    return (
        <div className="space-y-6 pb-20">
            <header className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">角色管理</h1>
                <p className="text-muted-foreground text-sm">
                    權限分成 3 種等級：讀取、編輯、管理。權限越高包含前面等級。
                </p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        現有角色
                        <form action={async () => {
                            "use server";
                            await syncDefaultRoles();
                        }}>
                            <Button size="sm" variant="outline">補齊預設角色</Button>
                        </form>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {roles.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground">目前無自訂角色</div>
                    ) : (
                        <div className="space-y-2">
                            {roles.map(role => (
                                <div key={role.id} className="flex items-center gap-3 p-3 border rounded-lg">
                                    <Shield className="h-5 w-5 text-secondary" />
                                    <div>
                                        <div className="font-semibold">{role.name}</div>
                                        <div className="text-xs text-muted-foreground">{role.description || role.code}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
