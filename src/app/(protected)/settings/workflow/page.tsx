import prisma from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, CheckCircle2, XCircle, Clock } from "lucide-react";
import { updateEntryStatus } from "@/app/actions/workflow";
import { getTenantId } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export default async function WorkflowPage() {
    const tenantId = await getTenantId();
    // 獲取待審核的單據
    const pendingEntries = await prisma.entry.findMany({
        where: { tenantId, status: 'PENDING' },
        include: { item: true, vendor: true },
        orderBy: { createdAt: 'desc' }
    });

    return (
        <div className="space-y-6 pb-20">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">審核工作流</h1>
                <p className="text-muted-foreground text-sm">管理單據審批流程</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                        <GitPullRequest className="h-4 w-4 text-primary" />
                        待審核清單 ({pendingEntries.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y text-sm">
                        {pendingEntries.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">目前無待審核單據</div>
                        ) : (
                            pendingEntries.map((entry: any) => (
                                <div key={entry.id} className="p-4 space-y-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-semibold">{entry.item?.name || '其他支出'}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {entry.type === 'PURCHASE' ? '採購進貨' : '日常支出'} | ${entry.totalPrice}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="text-[10px] flex gap-1 items-center">
                                            <Clock className="h-2.5 w-2.5" /> 待審核
                                        </Badge>
                                    </div>

                                    <div className="flex gap-2">
                                        <form action={async () => {
                                            'use server';
                                            await updateEntryStatus(entry.id, 'APPROVED');
                                        }} className="flex-1">
                                            <Button size="sm" variant="outline" className="w-full text-green-600 border-green-200 bg-green-50 hover:bg-green-100 hover:text-green-700 h-8">
                                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> 核准
                                            </Button>
                                        </form>
                                        <form action={async () => {
                                            'use server';
                                            await updateEntryStatus(entry.id, 'REJECTED');
                                        }} className="flex-1">
                                            <Button size="sm" variant="outline" className="w-full text-red-600 border-red-200 bg-red-50 hover:bg-red-100 hover:text-red-700 h-8">
                                                <XCircle className="h-3.5 w-3.5 mr-1" /> 駁回
                                            </Button>
                                        </form>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-muted/30">
                <CardContent className="p-4 text-xs text-muted-foreground flex gap-2">
                    <div className="mt-0.5">💡</div>
                    <div>系統預設進貨記錄為自動核准。如需啟用進階審核流程，請至系統設定中開啟「強制審核」功能。</div>
                </CardContent>
            </Card>
        </div>
    );
}
