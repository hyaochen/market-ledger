import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVendorPrices } from "./vendorCompare";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

test("需求2 廠商比價：五花肉 7 月有兩家廠商，單價已換算到元/kg 同一基準可比較", async () => {
    const result = await compareVendorPrices({ tenantId: REAL_TENANT_ID, query: "五花肉", from: "2026-07-01", to: "2026-07-31" });
    assert.ok(result.vendors.length >= 2, `應該有至少 2 家廠商，實際 ${result.vendors.length}`);
    assert.ok(result.vendors.every((v) => v.count > 0));
    // 由便宜到貴排序
    for (let i = 1; i < result.vendors.length; i++) {
        assert.ok(result.vendors[i - 1].avgPricePerKg <= result.vendors[i].avgPricePerKg);
    }
    assert.equal(result.cheapestVendorId, result.vendors[0].vendorId);
});

test("需求2 廠商比價：肝蓮跨月比價（同時有 catty/kg/jl 不同單位輸入，須換算才可比）", async () => {
    const result = await compareVendorPrices({ tenantId: REAL_TENANT_ID, query: "肝蓮", from: "2026-01-01", to: "2026-12-31" });
    assert.ok(result.vendors.length >= 1);
    for (const v of result.vendors) {
        assert.ok(v.avgPricePerKg > 0);
        assert.ok(v.minPricePerKg <= v.avgPricePerKg && v.avgPricePerKg <= v.maxPricePerKg);
    }
});

test("需求2 廠商比價：找不到品項時回傳空陣列，不是丟錯或假資料", async () => {
    const result = await compareVendorPrices({ tenantId: REAL_TENANT_ID, query: "不存在品項abc", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.vendors.length, 0);
    assert.equal(result.cheapestVendorId, null);
    assert.equal(result.priceSpreadPct, null);
});

test("需求2 廠商比價：tenantId 隔離", async () => {
    const result = await compareVendorPrices({ tenantId: DEMO_TENANT_ID, query: "五花肉", from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.vendors.length, 0);
});
