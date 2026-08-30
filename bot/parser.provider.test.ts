// Unit tests for T-ML-024: LLM provider switch (claude bridge primary, ollama fallback).
// Uses local http mock servers instead of real ollama/claude — no network calls, no API cost.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { callLLM } from "./parser";

// ── test helpers ──────────────────────────────────────────────────────
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

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => resolve(body));
    });
}

/** 找一個保證沒有服務在聽的 port，用來模擬「連不上」（fallback 條件 1） */
async function unreachableUrl(): Promise<string> {
    const srv = await startServer((_req, res) => res.end());
    await srv.close();
    return srv.url; // 剛關掉，port 保證沒人聽
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const prevKeys = Object.keys(vars);
    const prev: Record<string, string | undefined> = {};
    for (const k of prevKeys) prev[k] = process.env[k];
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

const OLLAMA_ENTRY_CONTENT = JSON.stringify({
    entries: [{ type: "PURCHASE", itemName: "豬耳", quantity: 6, unit: "公斤", price: 180, rawInput: "豬耳 6公斤 180" }],
});

function ollamaOkHandler(): http.RequestListener {
    return async (req, res) => {
        await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { content: OLLAMA_ENTRY_CONTENT } }));
    };
}

/** 用來證明「不該 fallback 到 ollama」的測試案例：如果程式誤觸發 fallback，
 * 這個 handler 回的內容跟預期斷言的內容不同 / HTTP 500，測試會直接爆炸而不是悄悄過。 */
function ollamaShouldNotBeCalledHandler(): http.RequestListener {
    return async (req, res) => {
        await readBody(req);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ollama should NOT have been called in this test" }));
    };
}

const CLAUDE_ENTRY_CONTENT = JSON.stringify({
    entries: [{ type: "PURCHASE", itemName: "肝連", quantity: 2.6, unit: "台斤", price: 218, rawInput: "肝連2.6台斤218" }],
});

// ── provider 選擇邏輯 ───────────────────────────────────────────────────

test("callLLM: LLM_PROVIDER=ollama calls ollama directly, never touches claude bridge", async () => {
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "ollama",
            OLLAMA_BASE_URL: ollama.url,
            CLAUDE_BRIDGE_URL: await unreachableUrl(), // 就算指向死路，ollama provider 模式也不該去碰它
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result!.length, 1);
        assert.equal(result![0].itemName, "豬耳");
    } finally {
        await ollama.close();
    }
});

test("callLLM: default provider (unset LLM_PROVIDER) is claude", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, content: CLAUDE_ENTRY_CONTENT, elapsedMs: 10 }));
    });
    const ollama = await startServer(ollamaShouldNotBeCalledHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: undefined,
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "肝連2.6台斤218", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "肝連", "should come from claude bridge, not ollama fallback");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

test("callLLM: claude success path never falls back to ollama", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, content: CLAUDE_ENTRY_CONTENT }));
    });
    const ollama = await startServer(ollamaShouldNotBeCalledHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "肝連2.6台斤218", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "肝連");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

test("callLLM: claude legit empty result ({entries:[]}) is NOT treated as a failure (no fallback)", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, content: '{"entries":[]}' }));
    });
    const ollama = await startServer(ollamaShouldNotBeCalledHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "隨便打的內容", "qwen2.5:7b"));
        assert.ok(result !== null, "valid-but-empty parse should return [], not null");
        assert.equal(result!.length, 0);
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

// ── 5 種 fallback 觸發條件（每種都用 mock ollama 驗證確實有退回）────────────

test("callLLM fallback #1: bridge unreachable (connect error) → falls back to ollama", async () => {
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: await unreachableUrl(),
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳", "should come from ollama fallback");
    } finally {
        await ollama.close();
    }
});

test("callLLM fallback #2: bridge timeout → falls back to ollama", async () => {
    const slowBridge = await startServer(async (req, res) => {
        await readBody(req);
        await new Promise((r) => setTimeout(r, 250)); // 故意拖過 timeout
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, content: CLAUDE_ENTRY_CONTENT }));
    });
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: slowBridge.url,
            CLAUDE_BRIDGE_TIMEOUT_MS: "80", // 遠小於 slowBridge 的 250ms delay
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳", "should come from ollama fallback after timeout");
    } finally {
        await slowBridge.close();
        await ollama.close();
    }
});

test("callLLM fallback #3: bridge HTTP non-2xx → falls back to ollama", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, errorType: "exec_error", error: "claude exit=1" }));
    });
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

test("callLLM fallback #4: bridge 200 but content is not parseable JSON → falls back to ollama", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, content: "抱歉，我不太確定你要我做什麼，可以再說明一下嗎？" }));
    });
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

test("callLLM fallback #5a: bridge 429 (quota) → falls back to ollama", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, errorType: "quota", error: "usage limit reached for this session" }));
    });
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});

test("callLLM fallback #5b: bridge 401 (auth) → falls back to ollama", async () => {
    const bridge = await startServer(async (req, res) => {
        await readBody(req);
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, errorType: "auth", error: "please run /login" }));
    });
    const ollama = await startServer(ollamaOkHandler());
    try {
        const result = await withEnv({
            LLM_PROVIDER: "claude",
            CLAUDE_BRIDGE_URL: bridge.url,
            OLLAMA_BASE_URL: ollama.url,
        }, () => callLLM("sys", "豬耳 6公斤 180", "qwen2.5:7b"));
        assert.ok(result);
        assert.equal(result![0].itemName, "豬耳");
    } finally {
        await bridge.close();
        await ollama.close();
    }
});
