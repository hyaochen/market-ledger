import { getUsers, getDepartments, getRoles } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { User, Shield, Building2 } from "lucide-react"; // Icons
import UserForm from "./UserForm";

export default async function UsersPage() {
    const users = await getUsers();
    const depts = await getDepartments();
    const roles = await getRoles();

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">使用者管理</h1>
                    <p className="text-muted-foreground text-sm">管理系統操作者與其權限</p>
                </div>
            </header>

            <div className="grid gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>使用者列表</CardTitle>
                        <UserForm departments={depts} roles={roles} />
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="rounded-md border">
                            {/* Note: In a mobile-first app, tables are tricky. Cards are better. */}
                            {users.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">尚無使用者</div>
                            ) : (
                                <div className="divide-y">
                                    {users.map(user => (
                                        <div key={user.id} className="flex flex-col p-4 gap-2 hover:bg-muted/50">
                                            <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-2">
                                                    <div className="bg-primary/10 p-2 rounded-full">
                                                        <User className="h-4 w-4 text-primary" />
                                                    </div>
                                                    <div>
                                                        <div className="font-semibold">{user.realName || user.username}</div>
                                                        <div className="text-xs text-muted-foreground">@{user.username}</div>
                                                    </div>
                                                </div>
                                                <div className={`text-xs px-2 py-1 rounded-full ${user.status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                    {user.status ? '啟用' : '停用'}
                                                </div>
                                            </div>

                                            <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                                                <div className="flex items-center gap-1">
                                                    <Building2 className="h-3 w-3" />
                                                    {user.department?.name || '無部門'}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Shield className="h-3 w-3" />
                                                    {user.roles.map(r => r.role.name).join(', ') || '無角色'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
