"use server";

import { ensurePosAccess } from "@/lib/pos-access";
import { summarizeSync, triggerSync, type SyncSummary } from "@/lib/pos-sync";

export type SyncActionResult =
    | { kind: "done"; summary: SyncSummary }
    | { kind: "message"; tone: "warn" | "bad"; message: string };

/** 「立即同步」按鈕：真實租戶的登入者才能觸發（demo 租戶不行），同步 + 推送跑完才回。 */
export async function syncNowAction(): Promise<SyncActionResult> {
    const auth = await ensurePosAccess();
    if (!auth.ok) return { kind: "message", tone: "bad", message: auth.error };

    const r = await triggerSync();
    switch (r.kind) {
        case "done":
            return { kind: "done", summary: summarizeSync(r.status) };
        case "busy":
            return { kind: "message", tone: "warn", message: "同步進行中，請稍後再試" };
        case "service_down":
            return { kind: "message", tone: "bad", message: "主電腦同步服務未啟動" };
        case "auth_failed":
            return { kind: "message", tone: "bad", message: "同步服務拒絕連線（密鑰不一致，請通知管理者）" };
        default:
            return { kind: "message", tone: "bad", message: r.message };
    }
}
