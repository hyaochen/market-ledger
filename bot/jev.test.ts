// Jev 品項快速判斷單元測試：重點是 fail-open（任何失敗都不能拋錯或卡住）
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { jevMatchItem } from "./jev";

const ITEMS = ["大骨高湯1600", "大骨高湯1601", "味鮮A", "肝蓮"];

function mockFetch(status: number, body: unknown): typeof fetch {
    return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
function answer(choice: string, confidence: number) {
    return { answers: { item: { type: "choice", choice, confidence, probabilities: {} } } };
}

test("jevMatchItem: 高信心選到真實品項 -> adopted", async () => {
    const r = await jevMatchItem("大骨粉，1600 40公斤，8200", "大骨粉", ITEMS, {
        apiKey: "test-key", fetchImpl: mockFetch(200, answer("大骨高湯1600", 0.97)),
    });
    assert.equal(r.status, "ok");
    assert.equal(r.adopted, true);
    assert.equal(r.choice, "大骨高湯1600");
});

test("jevMatchItem: 低信心 -> 不採用", async () => {
    const r = await jevMatchItem("味精", "味精", ITEMS, {
        apiKey: "test-key", fetchImpl: mockFetch(200, answer("味鮮A", 0.6)),
    });
    assert.equal(r.status, "ok");
    assert.equal(r.adopted, false);
});

test("jevMatchItem: 選 other -> 不採用", async () => {
    const r = await jevMatchItem("不明品項", "不明品項", ITEMS, {
        apiKey: "test-key", fetchImpl: mockFetch(200, answer("other", 0.99)),
    });
    assert.equal(r.adopted, false);
});

test("jevMatchItem: 回傳不在品項表內的選項 -> 不採用", async () => {
    const r = await jevMatchItem("x", "x", ITEMS, {
        apiKey: "test-key", fetchImpl: mockFetch(200, answer("憑空捏造", 0.99)),
    });
    assert.equal(r.adopted, false);
});

test("jevMatchItem: 未設 key -> skipped，不呼叫網路", async () => {
    let called = false;
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
        const r = await jevMatchItem("x", "x", ITEMS, {
            fetchImpl: (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch,
        });
        assert.equal(r.status, "skipped");
        assert.equal(r.adopted, false);
        assert.equal(called, false);
    } finally {
        if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
});

for (const code of [401, 402, 429, 500, 503]) {
    test(`jevMatchItem: HTTP ${code} -> fail-open，不拋錯`, async () => {
        const r = await jevMatchItem("x", "x", ITEMS, {
            apiKey: "bad-key", fetchImpl: mockFetch(code, { error: "nope" }),
        });
        assert.equal(r.status, "fail_open");
        assert.equal(r.adopted, false);
        assert.equal(r.reason, `http_${code}`);
    });
}

test("jevMatchItem: 逾時 -> fail-open，且在 timeout 附近返回", async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await jevMatchItem("x", "x", ITEMS, { apiKey: "k", timeoutMs: 80, fetchImpl: hang });
    assert.equal(r.status, "fail_open");
    assert.equal(r.reason, "timeout");
    assert.ok(Date.now() - t0 < 1000);
});

test("jevMatchItem: 網路錯誤 / 壞格式 -> fail-open", async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    assert.equal((await jevMatchItem("x", "x", ITEMS, { apiKey: "k", fetchImpl: boom })).status, "fail_open");
    assert.equal((await jevMatchItem("x", "x", ITEMS, { apiKey: "k", fetchImpl: mockFetch(200, { foo: 1 }) })).status, "fail_open");
});

test("jevMatchItem: 選項過多 (>=255) -> skipped", async () => {
    const many = Array.from({ length: 300 }, (_, i) => `品項${i}`);
    const r = await jevMatchItem("x", "x", many, { apiKey: "k", fetchImpl: mockFetch(200, answer("品項1", 1)) });
    assert.equal(r.status, "skipped");
});
