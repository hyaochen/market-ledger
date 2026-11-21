// 頻率限制單元測試（注入假時鐘，不碰 DB / 網路）

import { test } from "node:test";
import assert from "node:assert/strict";
import { WindowRateLimiter } from "./rateLimit";

function setup(max = 6, perHour = 30, maxKeys = 5000) {
    let t = 1_000_000;
    const lim = new WindowRateLimiter([
        { ms: 60_000, max },
        { ms: 3_600_000, max: perHour },
    ], maxKeys, () => t);
    return { lim, advance: (ms: number) => { t += ms; } };
}

test("每分鐘 6 則：第 7 則被拒，視窗過後恢復", () => {
    const { lim, advance } = setup();
    for (let i = 0; i < 6; i++) assert.equal(lim.tryConsume("a").allowed, true);
    assert.equal(lim.tryConsume("a").allowed, false);
    advance(60_001);
    assert.equal(lim.tryConsume("a").allowed, true);
});

test("被拒絕時每個視窗只通知一次，之後靜默", () => {
    const { lim, advance } = setup();
    for (let i = 0; i < 6; i++) lim.tryConsume("a");
    const first = lim.tryConsume("a");
    assert.deepEqual(first, { allowed: false, notify: true });
    for (let i = 0; i < 20; i++) assert.deepEqual(lim.tryConsume("a"), { allowed: false, notify: false });
    advance(60_001);
    for (let i = 0; i < 6; i++) lim.tryConsume("a");
    assert.equal(lim.tryConsume("a").notify, true, "新一輪封鎖會再通知一次");
});

test("被拒絕的請求不延長封鎖（持續灌訊息，視窗期滿後仍恢復）", () => {
    const { lim, advance } = setup();
    for (let i = 0; i < 6; i++) lim.tryConsume("a");
    for (let i = 0; i < 50; i++) { advance(1000); assert.equal(lim.tryConsume("a").allowed, false); }
    advance(11_000);
    assert.equal(lim.tryConsume("a").allowed, true);
});

test("每小時 30 則：分散在多個分鐘也會被擋", () => {
    const { lim, advance } = setup();
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
        if (lim.tryConsume("a").allowed) allowed++;
        advance(11_000); // 每 11 秒一則，不會觸發每分鐘上限
    }
    assert.equal(allowed, 30);
});

test("不同 key 互不影響", () => {
    const { lim } = setup();
    for (let i = 0; i < 6; i++) lim.tryConsume("a");
    assert.equal(lim.tryConsume("a").allowed, false);
    assert.equal(lim.tryConsume("b").allowed, true);
});

test("追蹤的 key 數量有上限，超過淘汰最舊的", () => {
    const { lim } = setup(6, 30, 3);
    for (const k of ["k1", "k2", "k3", "k4", "k5"]) lim.tryConsume(k);
    assert.equal(lim.size, 3);
    // k1 已被淘汰，等於全新：可以再用滿 6 次
    for (let i = 0; i < 6; i++) assert.equal(lim.tryConsume("k1").allowed, true);
});

test("LLM 頻率：5 分鐘 40 次，單則最壞情況 21 次在上限內", () => {
    let t = 0;
    const lim = new WindowRateLimiter([{ ms: 300_000, max: 40 }], 5000, () => t);
    // 一則訊息最壞：整段 1 次 + 逐行 20 次
    for (let i = 0; i < 21; i++) assert.equal(lim.tryConsume("mom").allowed, true);
    // 再來一則 8-15 筆的正常訊息（1 次）也沒問題
    for (let i = 0; i < 10; i++) assert.equal(lim.tryConsume("mom").allowed, true);
    for (let i = 0; i < 9; i++) lim.tryConsume("mom");
    assert.equal(lim.tryConsume("mom").allowed, false);
    t += 300_001;
    assert.equal(lim.tryConsume("mom").allowed, true);
});

test("cost 大於 1：放不下就整批拒絕且不記錄", () => {
    const { lim } = setup(6);
    assert.equal(lim.tryConsume("a", 7).allowed, false);
    assert.equal(lim.tryConsume("a", 6).allowed, true);
});
