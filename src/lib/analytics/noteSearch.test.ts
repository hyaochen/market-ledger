import { test } from "node:test";
import assert from "node:assert/strict";
import { searchNotes } from "./noteSearch";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

test("需求3 備註全文搜尋：「終身」能在 Entry.note 找到 7/20 那筆", async () => {
    const result = await searchNotes({ tenantId: REAL_TENANT_ID, query: "終身", from: "2026-07-01", to: "2026-07-31" });
    assert.ok(result.hits.some((h) => h.source === "entry" && h.date === "2026-07-20"));
});

test("需求3 備註全文搜尋：「來自 cash 清點」能在 Revenue.note 找到（7/31 修正後的營收）", async () => {
    const result = await searchNotes({ tenantId: REAL_TENANT_ID, query: "來自 cash 清點", from: "2026-07-01", to: "2026-07-31", source: "revenue" });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((h) => h.source === "revenue"));
});

test("需求3 備註全文搜尋：source=entry 只搜 Entry，不會混進 Revenue 結果", async () => {
    const result = await searchNotes({ tenantId: REAL_TENANT_ID, query: "潮州", from: "2026-07-01", to: "2026-07-31", source: "entry" });
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.every((h) => h.source === "entry"));
});

test("需求3 備註全文搜尋：空字串關鍵字回傳空結果", async () => {
    const result = await searchNotes({ tenantId: REAL_TENANT_ID, query: "   ", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.hits.length, 0);
});

test("需求3 備註全文搜尋：tenantId 隔離", async () => {
    const result = await searchNotes({ tenantId: DEMO_TENANT_ID, query: "終身", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.hits.length, 0);
});
