import { requireRole } from "@/lib/auth";
import { getLastImportAt } from "@/lib/yjc-db";
import { fmtDateTimeTaipei } from "@/lib/pos-format";
import PosSubNav from "./PosSubNav";

// 讀的是即時匯入的資料，不能被快取
export const dynamic = "force-dynamic";

export default async function PosLayout({ children }: { children: React.ReactNode }) {
    // POS 營業資料只給管理者看（write 角色的員工帳號看不到）
    await requireRole("admin");
    const last = getLastImportAt();

    return (
        <div className="space-y-4 pb-20">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">POS 資料</h1>
                <p className="text-muted-foreground text-sm">
                    最後同步時間：{last ? fmtDateTimeTaipei(last) : "尚未收到資料"}
                </p>
            </header>
            <PosSubNav />
            {children}
        </div>
    );
}
