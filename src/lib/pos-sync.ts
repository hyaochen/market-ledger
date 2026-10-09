// 「立即同步」：呼叫主機上的 POS 同步觸發服務（yjc-sync 的 HTTP 包裝，預設 :5066）。
//
//   GET  /status  -> { ok, running, last_run, last_push, pending_batches }
//   POST /sync    -> 同步 + 推送跑完才回（約 10 秒，上限 300 秒）；正在跑回 409
//
// 驗證：Authorization: Bearer <POS_IMPORT_TOKEN>（與匯入 API 同一把）。
// 這個檔案只放「呼叫」與「把回應翻成給人看的摘要」；摘要函式是純函式，有單元測試。

export type SyncGroup = {
    changed?: number;
    new?: number;
    rows?: number;
    changed_keys?: string[];
    new_keys?: string[];
};

export type SyncRun = {
    started_at?: string;
    finished_at?: string;
    seconds?: number;
    mode?: string;
    status?: string; // ok | unreachable | failed
    server?: string;
    error?: string;
    rows_written?: number;
    small_tables?: Record<string, number>;
    removed_orders?: unknown;
    groups?: { orders?: SyncGroup; shift?: SyncGroup };
};

export type SyncPush = {
    at?: string;
    status?: string; // ok | unreachable | failed | rejected | not_configured
    sent_batches?: number;
    pending_batches?: number;
    error?: string;
};

export type SyncStatus = {
    ok?: boolean;
    running?: boolean;
    last_run?: SyncRun | null;
    last_push?: SyncPush | null;
    pending_batches?: number;
    rc?: number;
};

const DEFAULT_URL = "http://host.docker.internal:5066";

function baseUrl(): string {
    return (process.env.POS_SYNC_URL || DEFAULT_URL).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
    const t = process.env.POS_IMPORT_TOKEN;
    return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 取最近一次同步狀態；連不到回 null（頁面照常顯示，只是不顯示同步資訊）。 */
export async function fetchSyncStatus(timeoutMs = 2500): Promise<SyncStatus | null> {
    try {
        const r = await fetch(`${baseUrl()}/status`, {
            headers: authHeaders(),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) return null;
        return (await r.json()) as SyncStatus;
    } catch {
        return null;
    }
}

export type SyncCallResult =
    | { kind: "done"; status: SyncStatus }
    | { kind: "busy" }
    | { kind: "service_down" }
    | { kind: "auth_failed" }
    | { kind: "error"; message: string };

/** 觸發同步並等它跑完。 */
export async function triggerSync(timeoutMs = 295_000): Promise<SyncCallResult> {
    let r: Response;
    try {
        r = await fetch(`${baseUrl()}/sync`, {
            method: "POST",
            headers: authHeaders(),
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        const name = e instanceof Error ? e.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
            return { kind: "error", message: "同步超過等待上限，請稍後看「最近一次同步」" };
        }
        return { kind: "service_down" };
    }
    if (r.status === 409) return { kind: "busy" };
    if (r.status === 401 || r.status === 403) return { kind: "auth_failed" };
    if (!r.ok) return { kind: "error", message: `同步服務回應異常（代碼 ${r.status}）` };
    try {
        return { kind: "done", status: (await r.json()) as SyncStatus };
    } catch {
        return { kind: "error", message: "同步服務回應格式不正確" };
    }
}

// ---------------------------------------------------------------------------
// 摘要（純函式）

export type SyncTone = "ok" | "warn" | "bad";

export type SyncSummary = {
    tone: SyncTone;
    headline: string; // 一句話結論
    lines: string[]; // 條列細節
    newOrders: string[];
    changedOrders: string[];
    removedOrders: string[];
};

export function describeRoute(server: string | undefined): string {
    if (!server) return "";
    if (server.startsWith("26.")) return "Radmin VPN";
    return "區網";
}

function asKeyList(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x));
    return [];
}

function removedCount(v: unknown): number {
    if (Array.isArray(v)) return v.length;
    if (typeof v === "number") return v;
    return 0;
}

export function describePush(p: SyncPush | null | undefined): { text: string; tone: SyncTone } {
    if (!p || !p.status) return { text: "尚無推送紀錄", tone: "warn" };
    const pending = p.pending_batches ?? 0;
    switch (p.status) {
        case "ok":
            return {
                text: pending > 0 ? `已推送，仍有 ${pending} 批待推` : "已推送到網站，沒有待推批次",
                tone: pending > 0 ? "warn" : "ok",
            };
        case "unreachable":
            return { text: `網站連不到，${pending} 批待推（下次會續推）`, tone: "warn" };
        case "rejected":
            return { text: `網站拒絕匯入（${p.error || "未知原因"}），${pending} 批待推`, tone: "bad" };
        case "not_configured":
            return { text: "尚未設定推送網址", tone: "bad" };
        default:
            return { text: `推送失敗（${p.error || p.status}），${pending} 批待推`, tone: "bad" };
    }
}

export function summarizeSync(s: SyncStatus): SyncSummary {
    const run = s.last_run ?? {};
    const orders = run.groups?.orders;
    const newOrders = asKeyList(orders?.new_keys);
    const changedOrders = asKeyList(orders?.changed_keys);
    const removed = asKeyList(run.removed_orders);
    const nNew = orders?.new ?? newOrders.length;
    const nChanged = orders?.changed ?? changedOrders.length;
    const nRemoved = removedCount(run.removed_orders);

    const route = describeRoute(run.server);
    const secs = typeof run.seconds === "number" ? `${run.seconds} 秒` : "";
    const push = describePush(s.last_push);

    if (run.status === "unreachable") {
        return {
            tone: "bad",
            headline: "連不到 POS（POS 關機、熱點或 VPN 未連線）",
            lines: [secs ? `花了 ${secs}` : "", run.error ? `訊息：${run.error}` : ""].filter(Boolean),
            newOrders: [],
            changedOrders: [],
            removedOrders: [],
        };
    }
    if (run.status !== "ok") {
        return {
            tone: "bad",
            headline: "同步失敗",
            lines: [secs ? `花了 ${secs}` : "", run.error ? `訊息：${run.error}` : ""].filter(Boolean),
            newOrders: [],
            changedOrders: [],
            removedOrders: [],
        };
    }

    const lines = [
        ["成功", route ? `經由 ${route}` : "", secs ? `花了 ${secs}` : ""].filter(Boolean).join("，"),
        `新增 ${nNew} 張單、修改 ${nChanged} 張、POS 端刪除 ${nRemoved} 張`,
        `推送：${push.text}`,
    ];
    const tone: SyncTone = push.tone === "bad" ? "bad" : push.tone === "warn" || nRemoved > 0 ? "warn" : "ok";
    return {
        tone,
        headline: push.tone === "ok" ? "同步完成" : "同步完成，但推送有狀況",
        lines,
        newOrders,
        changedOrders,
        removedOrders: removed,
    };
}

/** 頁首「最近一次同步」一行字（含每小時自動同步）。 */
export function describeLastRun(s: SyncStatus | null): { text: string; tone: SyncTone } {
    if (!s) return { text: "同步服務未連上，無法顯示最近一次同步", tone: "warn" };
    if (s.running) return { text: "同步進行中", tone: "warn" };
    const run = s.last_run;
    if (!run || !run.status) return { text: "尚無同步紀錄", tone: "warn" };
    const when = run.finished_at || run.started_at || "";
    const route = describeRoute(run.server);
    if (run.status === "ok") {
        const pend = s.pending_batches ?? s.last_push?.pending_batches ?? 0;
        return {
            text: `最近一次同步 ${when}：成功${route ? `（${route}）` : ""}${pend > 0 ? `，${pend} 批待推` : ""}`,
            tone: pend > 0 ? "warn" : "ok",
        };
    }
    if (run.status === "unreachable") {
        return { text: `最近一次同步 ${when}：連不到 POS（關機、熱點或 VPN 未連線）`, tone: "bad" };
    }
    return { text: `最近一次同步 ${when}：失敗${run.error ? `（${run.error}）` : ""}`, tone: "bad" };
}
