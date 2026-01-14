import { getOperationLogs } from "@/app/actions/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { FileClock, User as UserIcon, Activity } from "lucide-react";

export default async function LogsPage() {
    const logs = await getOperationLogs();

    return (
        <div className="space-y-6 pb-20">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">操作日誌</h1>
                <p className="text-muted-foreground text-sm">監控系統操作記錄與異常狀態</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileClock className="h-5 w-5 text-primary" />
                        最近日誌
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {logs.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">目前無操作記錄</div>
                        ) : (
                            logs.map((log: any) => (
                                <div key={log.id} className="p-4 hover:bg-muted/50 transition-colors">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${log.status === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                {log.action}
                                            </span>
                                            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                                {log.module}
                                            </span>
                                        </div>
                                        <span className="text-xs text-muted-foreground">
                                            {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss")}
                                        </span>
                                    </div>

                                    <div className="text-sm font-medium mb-1">
                                        {log.target || "系統操作"}
                                    </div>

                                    <div className="flex justify-between items-center text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1">
                                            <UserIcon className="h-3 w-3" />
                                            {log.user?.realName || log.user?.username || "系統"}
                                        </div>
                                        {log.duration && (
                                            <div className="flex items-center gap-1">
                                                <Activity className="h-3 w-3" />
                                                {log.duration}ms
                                            </div>
                                        )}
                                    </div>

                                    {log.details && (
                                        <div className="mt-2 p-2 bg-muted rounded text-[10px] font-mono whitespace-pre-wrap break-all opacity-70">
                                            {log.details}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
