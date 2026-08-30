// Unit tests for T-ML-026 (B): claude-bridge startup health check + owner Telegram alert.
// checkClaudeBridgeHealth is exercised against real local http mock servers (same
// pattern as bot/parser.provider.test.ts). findOwnerChatId / sendAlert are always
// fully mocked/injected in the orchestration tests -- these tests never touch the
// real DB or send a real Telegram message.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
    checkClaudeBridgeHealth,
    buildAlertMessage,
    runStartupBridgeHealthCheck,
    __resetAlertedFlagForTests,
} from "./bridgeHealth";

// ── test helpers (mirrors bot/parser.provider.test.ts) ─────────────────────────
function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => {
                    server.closeAllConnections();
                    server.close(() => r(undefined));
                }),
            });
        });
    });
}

async function unreachableUrl(): Promise<string> {
    const srv = await startServer((_req, res) => res.end());
    await srv.close();
    return srv.url; // just closed, port guaranteed to have nobody listening
}

// ── checkClaudeBridgeHealth ─────────────────────────────────────────────────────

test("checkClaudeBridgeHealth: healthy bridge -> ok:true", async () => {
    const srv = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, model: "sonnet", pid: 123 }));
    });
    try {
        const result = await checkClaudeBridgeHealth(srv.url);
        assert.deepEqual(result, { ok: true });
    } finally {
        await srv.close();
    }
});

test("checkClaudeBridgeHealth: unreachable (connect error) -> ok:false", async () => {
    const url = await unreachableUrl();
    const result = await checkClaudeBridgeHealth(url);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /connect-error/);
});

test("checkClaudeBridgeHealth: timeout -> ok:false", async () => {
    const srv = await startServer(async (_req, res) => {
        await new Promise((r) => setTimeout(r, 200));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
    });
    try {
        const result = await checkClaudeBridgeHealth(srv.url, 50);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /timeout/);
    } finally {
        await srv.close();
    }
});

test("checkClaudeBridgeHealth: HTTP non-2xx -> ok:false", async () => {
    const srv = await startServer((_req, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "boom" }));
    });
    try {
        const result = await checkClaudeBridgeHealth(srv.url);
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.reason, /http 500/);
    } finally {
        await srv.close();
    }
});

test("checkClaudeBridgeHealth: 200 but body reports ok:false -> ok:false", async () => {
    const srv = await startServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
    });
    try {
        const result = await checkClaudeBridgeHealth(srv.url);
        assert.equal(result.ok, false);
    } finally {
        await srv.close();
    }
});

// ── buildAlertMessage ───────────────────────────────────────────────────────────

test("buildAlertMessage: explains bridge down, ollama fallback, quality drop, and fix command", () => {
    const msg = buildAlertMessage("connect-error: ECONNREFUSED");
    assert.match(msg, /claude-bridge 沒有在跑/);
    assert.match(msg, /退回本地 ollama/);
    assert.match(msg, /正確率會下降/);
    assert.match(msg, /npm run claude-bridge/);
    assert.match(msg, /connect-error: ECONNREFUSED/);
});

test("buildAlertMessage: testPrefix is prepended when provided", () => {
    const msg = buildAlertMessage("timeout>3000ms", "[T-ML-026 測試]");
    assert.ok(msg.startsWith("[T-ML-026 測試] "), `expected message to start with test prefix, got: ${msg.slice(0, 40)}`);
});

test("buildAlertMessage: no prefix when omitted", () => {
    const msg = buildAlertMessage("timeout>3000ms");
    assert.ok(msg.startsWith("⚠️"), `expected message to start with warning emoji, got: ${msg.slice(0, 40)}`);
});

// ── runStartupBridgeHealthCheck orchestration (fully mocked deps) ──────────────

test("runStartupBridgeHealthCheck: LLM_PROVIDER=ollama skips entirely, never calls sendAlert", async () => {
    __resetAlertedFlagForTests();
    let alertCalled = false;
    const outcome = await runStartupBridgeHealthCheck({
        getProvider: () => "ollama",
        checkHealth: async () => { throw new Error("checkHealth should not be called when provider=ollama"); },
        sendAlert: async () => { alertCalled = true; },
    });
    assert.equal(outcome.skipped, true);
    assert.equal(alertCalled, false);
});

test("runStartupBridgeHealthCheck: healthy bridge -> no alert", async () => {
    __resetAlertedFlagForTests();
    let alertCalled = false;
    const outcome = await runStartupBridgeHealthCheck({
        getProvider: () => "claude",
        getBridgeUrl: () => "http://unused",
        checkHealth: async () => ({ ok: true }),
        sendAlert: async () => { alertCalled = true; },
    });
    assert.deepEqual(outcome, { skipped: false, healthy: true });
    assert.equal(alertCalled, false);
});

test("runStartupBridgeHealthCheck: unhealthy + owner found -> sends exactly one alert to owner's chat id", async () => {
    __resetAlertedFlagForTests();
    const alerts: { chatId: number; text: string }[] = [];
    const outcome = await runStartupBridgeHealthCheck({
        getProvider: () => "claude",
        getBridgeUrl: () => "http://unused",
        checkHealth: async () => ({ ok: false, reason: "connect-error: ECONNREFUSED" }),
        findOwnerChatId: async () => 591516181794652171,
        sendAlert: async (chatId, text) => { alerts.push({ chatId, text }); },
    });
    assert.equal(outcome.skipped, false);
    if (!outcome.skipped) {
        assert.equal(outcome.healthy, false);
        if (!outcome.healthy) assert.equal(outcome.alerted, true);
    }
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].chatId, 591516181794652171);
    assert.match(alerts[0].text, /claude-bridge 沒有在跑/);
});

test("runStartupBridgeHealthCheck: unhealthy + no owner chat id available -> does not throw, does not alert", async () => {
    __resetAlertedFlagForTests();
    let alertCalled = false;
    const outcome = await runStartupBridgeHealthCheck({
        getProvider: () => "claude",
        getBridgeUrl: () => "http://unused",
        checkHealth: async () => ({ ok: false, reason: "timeout>3000ms" }),
        findOwnerChatId: async () => null,
        sendAlert: async () => { alertCalled = true; },
    });
    assert.equal(outcome.skipped, false);
    if (!outcome.skipped && !outcome.healthy) {
        assert.equal(outcome.alerted, false);
        assert.equal(outcome.alertReason, "no owner chat id available");
    }
    assert.equal(alertCalled, false);
});

test("runStartupBridgeHealthCheck: de-dup -- calling twice while unhealthy only alerts once", async () => {
    __resetAlertedFlagForTests();
    const alerts: string[] = [];
    const deps = {
        getProvider: () => "claude" as const,
        getBridgeUrl: () => "http://unused",
        checkHealth: async () => ({ ok: false as const, reason: "connect-error: ECONNREFUSED" }),
        findOwnerChatId: async () => 591516181794652171,
        sendAlert: async (_chatId: number, text: string) => { alerts.push(text); },
    };
    const first = await runStartupBridgeHealthCheck(deps);
    const second = await runStartupBridgeHealthCheck(deps);

    assert.equal(alerts.length, 1, "should only have sent one alert across both calls");
    if (!first.skipped && !first.healthy) assert.equal(first.alerted, true);
    if (!second.skipped && !second.healthy) {
        assert.equal(second.alerted, false);
        assert.equal(second.alertReason, "already alerted this process");
    }
    __resetAlertedFlagForTests(); // leave module state clean for subsequent tests
});

test("runStartupBridgeHealthCheck: no sendAlert wired -> reports not alerted instead of throwing", async () => {
    __resetAlertedFlagForTests();
    const outcome = await runStartupBridgeHealthCheck({
        getProvider: () => "claude",
        getBridgeUrl: () => "http://unused",
        checkHealth: async () => ({ ok: false, reason: "timeout>3000ms" }),
        findOwnerChatId: async () => 591516181794652171,
        // sendAlert intentionally omitted
    });
    assert.equal(outcome.skipped, false);
    if (!outcome.skipped && !outcome.healthy) {
        assert.equal(outcome.alerted, false);
        assert.equal(outcome.alertReason, "no sendAlert function provided");
    }
    __resetAlertedFlagForTests();
});
