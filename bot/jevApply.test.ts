// applyJevMatch：Jev 高信心採用 -> 直接存（若其他欄位本來就符合），其餘照舊確認
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyJevMatch, type EnrichFn, type JevFn } from "./jevApply";
import type { ParsedEntry, DbContext } from "./types";

const ctx = {
    tenantId: "t",
    items: [
        { id: "i1", name: "豬耳", categoryId: "c", defaultUnit: "台斤", categoryName: "x" },
        { id: "i2", name: "大骨高湯1600", categoryId: "c", defaultUnit: "kg", categoryName: "x" },
        { id: "i3", name: "大骨高湯1601", categoryId: "c", defaultUnit: "kg", categoryName: "x" },
    ],
} as unknown as DbContext;

function entry(over: Partial<ParsedEntry>): ParsedEntry {
    return {
        type: "PURCHASE", date: "2026-10-09", rawInput: "耳朵 3斤 300", itemId: null, itemName: "耳朵",
        vendorId: null, vendorName: null, quantity: 3, unit: "台斤", expenseType: null,
        locationId: null, locationName: null, price: 300, note: null,
        confident: false, uncertainReason: "找不到品項「耳朵」，請確認", ...over,
    } as ParsedEntry;
}

// 假 matcher：標準品名完全命中 -> itemId 設定；confident 由 flags 決定
function fakeEnrich(opts: { confident: boolean; reason?: string }): EnrichFn {
    return async (e) => {
        const it = ctx.items.find(i => i.name === e.itemName);
        return { ...e, itemId: it?.id ?? null, confident: opts.confident, uncertainReason: opts.reason ?? null };
    };
}
const jevOk = (choice: string): JevFn => async () => ({ status: "ok", adopted: true, choice, confidence: 0.98, latencyMs: 200 });

test("Jev 高信心 + 其他欄位 OK -> confident=true 直接存，帶出 耳朵 -> 豬耳", async () => {
    const raw = entry({});
    const r = await applyJevMatch("耳朵 3斤 300", raw, raw, ctx, fakeEnrich({ confident: true }), jevOk("豬耳"));
    assert.equal(r.entry.confident, true);
    assert.equal(r.entry.itemId, "i1");
    assert.deepEqual(r.entry._jevMapping, { from: "耳朵", to: "豬耳" });
    assert.equal(r.entry.rawInput, "耳朵 3斤 300");
    assert.equal(r.jev?.adopted, true);
});

test("Jev 採用但 matcher 仍有其他待確認原因（重複偵測）-> 照舊確認並保留原因", async () => {
    const raw = entry({});
    const r = await applyJevMatch("耳朵 3斤 300", raw, raw, ctx,
        fakeEnrich({ confident: false, reason: "今天已有此記錄（$300），確定再記一筆？" }), jevOk("豬耳"));
    assert.equal(r.entry.confident, false);
    assert.match(r.entry.uncertainReason ?? "", /耳朵.*豬耳.*AI 判斷/);
    assert.match(r.entry.uncertainReason ?? "", /今天已有此記錄/);
});

test("Jev 低信心 / other -> 維持原本待確認的 entry", async () => {
    const raw = entry({});
    const low: JevFn = async () => ({ status: "ok", adopted: false, choice: "豬耳", confidence: 0.6, latencyMs: 100 });
    const r = await applyJevMatch("耳朵 3斤 300", raw, raw, ctx, fakeEnrich({ confident: true }), low);
    assert.equal(r.entry, raw);
    assert.equal(r.entry.confident, false);
});

test("Jev fail-open（逾時）-> 原 entry 不變", async () => {
    const raw = entry({});
    const fail: JevFn = async () => ({ status: "fail_open", adopted: false, choice: null, confidence: null, latencyMs: 1500, reason: "timeout" });
    const r = await applyJevMatch("耳朵 3斤 300", raw, raw, ctx, fakeEnrich({ confident: true }), fail);
    assert.equal(r.entry, raw);
});

test("Jev 或 enrich 拋錯 -> fail-open 回原 entry", async () => {
    const raw = entry({});
    const boom: JevFn = async () => { throw new Error("boom"); };
    assert.equal((await applyJevMatch("x", raw, raw, ctx, fakeEnrich({ confident: true }), boom)).entry, raw);
    const badEnrich: EnrichFn = async () => { throw new Error("db"); };
    assert.equal((await applyJevMatch("x", raw, raw, ctx, badEnrich, jevOk("豬耳"))).entry, raw);
});

test("模糊名「大骨粉」不交給 Jev，維持候選確認", async () => {
    const raw = entry({ itemName: "大骨粉", rawInput: "大骨粉 40公斤 8200" });
    let called = false;
    const spy: JevFn = async () => { called = true; return { status: "ok", adopted: true, choice: "大骨高湯1600", confidence: 1, latencyMs: 1 }; };
    const r = await applyJevMatch("大骨粉 40公斤 8200", raw, raw, ctx, fakeEnrich({ confident: true }), spy);
    assert.equal(called, false);
    assert.equal(r.entry, raw);
});

test("matcher 已找到品項 或 非進貨 -> 不呼叫 Jev", async () => {
    let n = 0;
    const spy: JevFn = async () => { n++; return { status: "ok", adopted: true, choice: "豬耳", confidence: 1, latencyMs: 1 }; };
    const matched = entry({ itemId: "i1", confident: true });
    await applyJevMatch("x", matched, matched, ctx, fakeEnrich({ confident: true }), spy);
    const exp = entry({ type: "EXPENSE" });
    await applyJevMatch("x", exp, exp, ctx, fakeEnrich({ confident: true }), spy);
    assert.equal(n, 0);
});
