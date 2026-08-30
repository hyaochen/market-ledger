import { test } from "node:test";
import assert from "node:assert/strict";
import { searchItemPurchases } from "./itemSearch";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

test("需求1 品項搜尋：模糊比對「五花」找得到 7 月真實進貨（含單價換算）", async () => {
    const result = await searchItemPurchases({ tenantId: REAL_TENANT_ID, query: "五花", from: "2026-07-01", to: "2026-07-31" });
    assert.ok(result.matchedItems.length > 0);
    assert.ok(result.rows.length >= 4, "7 月五花肉應該有 4 筆進貨（7/9, 7/11, 7/25, 7/31）");
    const july11 = result.rows.find((r) => r.date === "2026-07-11");
    assert.ok(july11);
    assert.ok(july11!.pricePerKg != null && Math.abs(july11!.pricePerKg - 652.13) < 0.1);
});

test("需求1 品項搜尋：itemId 直接指定時略過模糊比對", async () => {
    const byName = await searchItemPurchases({ tenantId: REAL_TENANT_ID, query: "五花肉", from: "2026-07-01", to: "2026-07-31" });
    const itemId = byName.matchedItems[0]?.id;
    assert.ok(itemId);
    const byId = await searchItemPurchases({ tenantId: REAL_TENANT_ID, itemId, from: "2026-07-01", to: "2026-07-31" });
    assert.equal(byId.rows.length, byName.rows.length);
});

test("需求1 品項搜尋：查無此品項時回傳空結果而非丟錯", async () => {
    const result = await searchItemPurchases({ tenantId: REAL_TENANT_ID, query: "完全不存在的品項xyz123", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.matchedItems.length, 0);
    assert.equal(result.rows.length, 0);
});

test("需求1 品項搜尋：tenantId 隔離 — demo 租戶查不到真實租戶的五花肉進貨", async () => {
    const result = await searchItemPurchases({ tenantId: DEMO_TENANT_ID, query: "五花肉", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.rows.length, 0);
});
