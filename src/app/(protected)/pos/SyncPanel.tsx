"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { syncNowAction } from "./actions";
import type { SyncSummary, SyncTone } from "@/lib/pos-sync";

type Line = { text: string; tone: SyncTone };

const TONE_TEXT: Record<SyncTone, string> = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
};
const TONE_BORDER: Record<SyncTone, string> = {
    ok: "border-emerald-500/50",
    warn: "border-amber-500/60",
    bad: "border-red-500/60",
};

type Result =
    | { kind: "summary"; summary: SyncSummary }
    | { kind: "message"; tone: SyncTone; message: string }
    | null;

export default function SyncPanel({ initialLine, initialRunning }: { initialLine: Line; initialRunning: boolean }) {
    const router = useRouter();
    const [running, setRunning] = useState(initialRunning);
    const [elapsed, setElapsed] = useState(0);
    const [result, setResult] = useState<Result>(null);
    const [line, setLine] = useState<Line>(initialLine);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const poller = useRef<ReturnType<typeof setInterval> | null>(null);

    // 伺服器重新渲染（例如同步完成後 router.refresh）會帶新的最近一次同步，跟著更新
    useEffect(() => {
        setLine(initialLine);
    }, [initialLine.text, initialLine.tone]); // eslint-disable-line react-hooks/exhaustive-deps

    function stopTimers() {
        if (timer.current) clearInterval(timer.current);
        if (poller.current) clearInterval(poller.current);
        timer.current = null;
        poller.current = null;
    }
    useEffect(() => stopTimers, []);

    function startElapsed() {
        setElapsed(0);
        if (timer.current) clearInterval(timer.current);
        const t0 = Date.now();
        timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    }

    // 連線中斷或同步時間太長：改輪詢狀態，等到服務回報不在跑了就更新畫面
    function pollUntilIdle() {
        if (poller.current) clearInterval(poller.current);
        let tries = 0;
        poller.current = setInterval(async () => {
            tries += 1;
            try {
                const r = await fetch("/api/pos-sync-status", { cache: "no-store" });
                const j = await r.json();
                if (j.ok && j.reachable && !j.running) {
                    stopTimers();
                    setRunning(false);
                    setLine(j.line);
                    setResult({ kind: "message", tone: j.line.tone, message: "連線中斷期間同步已結束：" + j.line.text });
                    router.refresh();
                }
            } catch {
                /* 繼續等 */
            }
            if (tries > 120) {
                stopTimers();
                setRunning(false);
                setResult({ kind: "message", tone: "warn", message: "等不到同步結果，請重新整理頁面確認" });
            }
        }, 3000);
    }

    useEffect(() => {
        if (initialRunning) {
            startElapsed();
            pollUntilIdle();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function onSync() {
        if (running) return;
        setRunning(true);
        setResult(null);
        startElapsed();
        try {
            const r = await syncNowAction();
            stopTimers();
            setRunning(false);
            if (r.kind === "done") {
                setResult({ kind: "summary", summary: r.summary });
            } else {
                setResult({ kind: "message", tone: r.tone, message: r.message });
            }
            router.refresh(); // 重新讀取頁面資料與最近一次同步
        } catch {
            // 連線被中斷（例如經 Cloudflare 的等待上限）；同步可能還在主機上跑
            if (timer.current) clearInterval(timer.current);
            setResult({ kind: "message", tone: "warn", message: "連線中斷，改為查詢同步進度..." });
            pollUntilIdle();
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    onClick={onSync}
                    disabled={running}
                    className="h-10 inline-flex items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60 active:opacity-80"
                >
                    <svg
                        viewBox="0 0 24 24"
                        className={"h-4 w-4 " + (running ? "animate-spin" : "")}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                    >
                        <path d="M21 12a9 9 0 1 1-3-6.7" />
                        <path d="M21 3v6h-6" />
                    </svg>
                    {running ? "同步中..." : "立即同步"}
                </button>
                <span className={"text-xs " + TONE_TEXT[line.tone]}>{line.text}</span>
            </div>

            {running && (
                <div className="rounded-md border p-3 text-sm space-y-2" role="status" aria-live="polite">
                    <div>同步進行中，已 {elapsed} 秒（通常約 10 秒，最久 5 分鐘）</div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
                    </div>
                    <div className="text-xs text-muted-foreground">先抓 POS 的變動，再推送到網站，完成後會自動更新畫面。</div>
                </div>
            )}

            {!running && result?.kind === "message" && (
                <div className={"rounded-md border p-3 text-sm " + TONE_BORDER[result.tone]} role="status">
                    <span className={TONE_TEXT[result.tone]}>{result.message}</span>
                </div>
            )}

            {!running && result?.kind === "summary" && (
                <div className={"rounded-md border p-3 text-sm space-y-1 " + TONE_BORDER[result.summary.tone]} role="status">
                    <div className={"font-semibold " + TONE_TEXT[result.summary.tone]}>{result.summary.headline}</div>
                    {result.summary.lines.map((l, i) => (
                        <div key={i}>{l}</div>
                    ))}
                    <KeyList label="新增的單號" keys={result.summary.newOrders} />
                    <KeyList label="修改的單號" keys={result.summary.changedOrders} />
                    <KeyList label="POS 端刪除的單號" keys={result.summary.removedOrders} />
                    <button
                        type="button"
                        onClick={() => setResult(null)}
                        className="text-xs text-muted-foreground underline underline-offset-2"
                    >
                        關閉摘要
                    </button>
                </div>
            )}
        </div>
    );
}

function KeyList({ label, keys }: { label: string; keys: string[] }) {
    if (keys.length === 0) return null;
    return (
        <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
                {label}（{keys.length}）
            </summary>
            <div className="mt-1 break-all leading-relaxed">{keys.join("、")}</div>
        </details>
    );
}
