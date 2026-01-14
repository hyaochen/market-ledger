import prisma from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Database, Server, HardDrive } from "lucide-react";

export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
    // 簡單測量延遲
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - start;

    // 獲取一些統計資料
    const stats = await Promise.all([
        prisma.user.count(),
        prisma.entry.count(),
        prisma.revenue.count(),
        prisma.operationLog.count(),
    ]);

    return (
        <div className="space-y-6 pb-20">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">系統監測</h1>
                <p className="text-muted-foreground text-sm">監視資料庫與伺服器運作狀態</p>
            </header>

            <div className="grid gap-4">
                <Card className="border-green-200 bg-green-50/50">
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Database className="h-4 w-4 text-green-600" />
                            資料庫狀態
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-700">Healthy</div>
                        <p className="text-xs text-green-600 mt-1">連線延遲: {dbLatency}ms</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <HardDrive className="h-4 w-4 text-primary" />
                            資料統計
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">使用者總數</span>
                            <span className="font-semibold">{stats[0]}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">進貨/支出記錄</span>
                            <span className="font-semibold">{stats[1]}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">營收記錄</span>
                            <span className="font-semibold">{stats[2]}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">系統日誌筆數</span>
                            <span className="font-semibold">{stats[3]}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="py-4">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Server className="h-4 w-4 text-primary" />
                            伺服器資訊
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <div>架構: Next.js (App Router) + Prisma + SQLite</div>
                        <div>執行環境: Production (Simulated)</div>
                        <div>連線池: 已啟用 (Prisma Client Singleton)</div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
