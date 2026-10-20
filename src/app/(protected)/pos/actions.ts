"use server";

import { ensurePosAccess } from "@/lib/pos-access";
import { ensureRole } from "@/lib/auth";
import { summarizeSync, syncCooldownRemainingSeconds, triggerSync, type SyncSummary } from "@/lib/pos-sync";

export type SyncActionResult =
    | { kind: "done"; summary: SyncSummary }
    | { kind: "message"; tone: "warn" | "bad"; message: string };

// 全站共用一個冷卻（同步服務本來就是單一主電腦）；重啟後歸零，這裡不需要持久化。
const SYNC_COOLDOWN_MS = 60_000;
let lastSyncStartedAt: number | null = null;

/** 「立即同步」按鈕：POS 允許名單內的租戶、且角色至少 write 才能觸發；60 秒冷卻；同步 + 推送跑完才回。 */
export async function syncNowAction(): Promise<SyncActionResult> {
    const auth = await ensurePosAccess();
    if (!auth.ok) return { kind: "message", tone: "bad", message: auth.error };
    const role = await ensureRole("write");
    if (!role.ok) return { kind: "message", tone: "bad", message: role.error };

    const wait = syncCooldownRemainingSeconds(Date.now(), lastSyncStartedAt, SYNC_COOLDOWN_MS);
    if (wait > 0) {
        return { kind: "message", tone: "warn", message: `剛剛才同步過，請 ${wait} 秒後再試` };
    }
    lastSyncStartedAt = Date.now();

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
