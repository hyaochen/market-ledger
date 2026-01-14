import { getDepartments, deleteDepartment } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { FolderTree, Trash2 } from "lucide-react";
import DeptForm from "./DeptForm"; // Client Component for interaction

export default async function DepartmentPage() {
    const depts = await getDepartments();

    // Simple flatten function for table view (Real tree view is complex, using table with indentation for now)
    // 這裡簡單展示，實際可能需要遞迴渲染

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">機構管理</h1>
                    <p className="text-muted-foreground text-sm">設定公司部門組織架構</p>
                </div>
            </header>

            <div className="grid gap-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>部門列表</CardTitle>
                        <DeptForm parentOptions={depts} />
                    </CardHeader>
                    <CardContent>
                        {depts.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground">尚未建立部門</div>
                        ) : (
                            <div className="space-y-2">
                                {depts.map(dept => (
                                    <div key={dept.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
                                        <div className="flex items-center gap-2">
                                            <FolderTree className="h-5 w-5 text-primary" />
                                            <span className={dept.parentId ? "ml-4" : "font-semibold"}>{dept.name}</span>
                                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">成員: {dept._count.users}</span>
                                        </div>
                                        <form action={async () => {
                                            'use server';
                                            await deleteDepartment(dept.id);
                                        }}>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </form>
                                    </div>
                                ))}
                            </div>
                        )}

                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
