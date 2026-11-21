// 問題 9：逐行重試的行數上限、總時間上限、使用者 LLM 額度上限（本地假 LLM，不連任何外部服務）

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
    parseEntries, newParseDiagnostics,
    MAX_RETRY_LINES, TOO_MANY_LINES_NOTICE, PARSE_TIMEOUT_NOTICE, PARSE_RATE_NOTICE,
} from "./parser";
import { WindowRateLimiter, LLM_CALLS_PER_WINDOW } from "./rateLimit";
import type { DbContext } from "./types";

const CTX = { locations: [] } as unknown as DbContext;

// 整段呼叫只回 1 筆、每一行單獨呼叫各回 1 筆，並記錄 LLM 被呼叫的次數
async function withStubLlm<T>(fn: (calls: { n: number }) => Promise<T>): Promise<T> {
    const calls = { n: 0 };
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
            calls.n++;
            let user = "";
            try { user = JSON.parse(body).messages?.[1]?.content ?? ""; } catch { /* ignore */ }
            const name = user.includes("\n") ? "整段品項" : user.replace(/\s.*/, "") || "品項";
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ message: { content: JSON.stringify({ entries: [
                { type: "PURCHASE", itemName: name, quantity: 1, unit: "個", price: 10 + calls.n, rawInput: user },
            ] }) } }));
        });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const prev = { p: process.env.LLM_PROVIDER, u: process.env.OLLAMA_BASE_URL };
    process.env.LLM_PROVIDER = "ollama";
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
        return await fn(calls);
    } finally {
        if (prev.p === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = prev.p;
        if (prev.u === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = prev.u;
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
    }
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `品項${i + 1} ${i + 1}個 ${100 + i}`).join("\n");

test("20 行以內：照舊逐行重試（1 + 行數 次呼叫），沒有提示", async () => {
    await withStubLlm(async (calls) => {
        const diag = newParseDiagnostics();
        const out = await parseEntries(lines(MAX_RETRY_LINES), CTX, diag);
        assert.equal(calls.n, 1 + MAX_RETRY_LINES);
        assert.equal(out.length, MAX_RETRY_LINES);
        assert.deepEqual(diag.notices, []);
    });
});

test("超過 20 行：不逐行重試，保留整段結果並提示分批", async () => {
    await withStubLlm(async (calls) => {
        const diag = newParseDiagnostics();
        const out = await parseEntries(lines(MAX_RETRY_LINES + 1), CTX, diag);
        assert.equal(calls.n, 1);
        assert.equal(out.length, 1);
        assert.deepEqual(diag.notices, [TOO_MANY_LINES_NOTICE]);
    });
});

test("總時間超過 90 秒：停止逐行重試，用已取得的結果並提示", async () => {
    await withStubLlm(async (calls) => {
        let t = 0;
        const diag = newParseDiagnostics();
        // 每次問時鐘就前進 40 秒：開始 0、第 1 行 40、第 2 行 80、第 3 行 120 > 90 秒
        diag.now = () => { const v = t; t += 40_000; return v; };
        const out = await parseEntries(lines(8), CTX, diag);
        assert.equal(calls.n, 1 + 2, "整段 1 次 + 逐行只做了 2 行");
        assert.deepEqual(diag.notices, [PARSE_TIMEOUT_NOTICE]);
        assert.ok(out.length >= 1);
    });
});

test("使用者 LLM 額度用完：停止逐行重試並提示", async () => {
    await withStubLlm(async (calls) => {
        const diag = newParseDiagnostics();
        let budget = 3;
        diag.allowLlmCall = () => budget-- > 0;
        await parseEntries(lines(8), CTX, diag);
        assert.equal(calls.n, 1 + 3);
        assert.deepEqual(diag.notices, [PARSE_RATE_NOTICE]);
    });
});

test("單則最壞情況（整段 1 + 逐行 20）在每人 5 分鐘 40 次上限內，媽媽連傳兩則 15 筆也不會被擋", () => {
    assert.ok(1 + MAX_RETRY_LINES <= LLM_CALLS_PER_WINDOW);
    const lim = new WindowRateLimiter([{ ms: 300_000, max: LLM_CALLS_PER_WINDOW }], 5000, () => 0);
    // 兩則各 1 次整段 + 15 次逐行 = 32 次
    for (let i = 0; i < 32; i++) assert.equal(lim.tryConsume("mom").allowed, true);
});
