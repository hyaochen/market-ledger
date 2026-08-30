import { test } from "node:test";
import assert from "node:assert/strict";
import { getItemPriceTrend } from "./priceTrend";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

test("需求4 價格趨勢：五花肉月均單價（跨月），第一個有資料月份 momChangePct 為 null", async () => {
    const result = await getItemPriceTrend({ tenantId: REAL_TENANT_ID, query: "五花肉", from: "2026-01-01", to: "2026-12-31" });
    assert.ok(result.months.length > 0);
    assert.equal(result.months[0].momChangePct, null);
    for (const m of result.months.slice(1)) {
        assert.notEqual(m.momChangePct, undefined);
    }
});

test("需求4 價格趨勢：7 月因為 7/11 離群值把當月均價拉高，應該被抓成 biggestJump 候選之一", async () => {
    const result = await getItemPriceTrend({ tenantId: REAL_TENANT_ID, query: "五花肉", from: "2026-01-01", to: "2026-12-31" });
    const july = result.months.find((m) => m.month === "2026-07");
    assert.ok(july);
    assert.ok(july!.maxPricePerKg >= 600, "7 月應該包含 7/11 的離群單價");
});

test("需求4 價格趨勢：找不到品項回傳空月份清單", async () => {
    const result = await getItemPriceTrend({ tenantId: REAL_TENANT_ID, query: "不存在品項xyz", from: "2026-01-01", to: "2026-12-31" });
    assert.equal(result.months.length, 0);
    assert.equal(result.biggestJump, null);
});

test("需求4 價格趨勢：tenantId 隔離", async () => {
    const result = await getItemPriceTrend({ tenantId: DEMO_TENANT_ID, query: "五花肉", from: "2026-01-01", to: "2026-12-31" });
    assert.equal(result.months.length, 0);
});
