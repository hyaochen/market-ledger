import { requirePosAccess } from "@/lib/pos-access";
import { getLastImportAt } from "@/lib/yjc-db";
import { fmtDateTimeTaipei } from "@/lib/pos-format";
import { describeLastRun, fetchSyncStatus } from "@/lib/pos-sync";
import PosSubNav from "./PosSubNav";
import SyncPanel from "./SyncPanel";

// 讀的是即時匯入的資料，不能被快取
export const dynamic = "force-dynamic";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
    // POS 營業資料：真實租戶的登入者都能看，demo 租戶一律擋（見 pos-access.ts）。
    // 注意：每個 page 也各自檢查一次，因為 layout 在 client 端導覽時不一定會重新執行。
    await requirePosAccess();
    const last = getLastImportAt();
    const status = await fetchSyncStatus();
    const line = describeLastRun(status);

    return (
        <div className="space-y-4 pb-20">
            <header className="space-y-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">POS 資料</h1>
                    <p className="text-muted-foreground text-sm">
                        最後匯入時間：{last ? fmtDateTimeTaipei(last) : "尚未收到資料"}（POS 每小時自動同步）
                    </p>
                </div>
                <SyncPanel initialLine={line} initialRunning={status?.running === true} />
            </header>
            <PosSubNav />
            {children}
        </div>
    );
}
