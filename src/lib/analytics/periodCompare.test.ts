import { test } from "node:test";
import assert from "node:assert/strict";
import { getPeriodComparison } from "./periodCompare";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";
import prisma from "@/lib/prisma";
import { monthRangeUTC } from "./dateRange";

// 這裡刻意不寫死金額魔術數字（7 月營收在稽核之後又被 CashCount 自動同步改過一次，
// 寫死數字容易在資料持續變動時變成假警報）。改成每次測試自己用獨立的 Prisma
// aggregate 查「同一個月份的 ground truth」，跟 getPeriodComparison() 算出來的結果
//互相比對 —— 這樣不管資料之後再變動幾次，測試邏輯本身仍然成立。

test("需求6 月環比：July 2026 revenueTotal 跟獨立 aggregate 查詢一致", async () => {
    const range = monthRangeUTC(2026, 7);
    const groundTruth = await prisma.revenue.aggregate({
        where: { tenantId: REAL_TENANT_ID, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
        _sum: { amount: true },
    });

    const result = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    assert.equal(result.current.revenueTotal, groundTruth._sum.amount ?? 0);
});

test("需求6 月環比：expenseByCategory 加總等於 expenseTotal（不含進貨）", async () => {
    const result = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    const sum = result.current.expenseByCategory.reduce((s, c) => s + c.amount, 0);
    assert.equal(sum, result.current.expenseTotal);
});

test("需求6 月環比：totalCost = purchaseTotal + expenseTotal，profit = revenue - totalCost", async () => {
    const result = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    const c = result.current;
    assert.equal(c.totalCost, c.purchaseTotal + c.expenseTotal);
    assert.equal(c.profit, c.revenueTotal - c.totalCost);
});

test("需求6 月環比：MoM 對照月正確地是上一個月（6 月），delta 計算方向正確", async () => {
    const result = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    assert.ok(result.mom);
    assert.equal(result.mom!.previous.month, "2026-06");
    const expectedDelta = result.current.profit - result.mom!.previous.profit;
    assert.equal(result.mom!.delta.profitDelta, expectedDelta);
});

test("需求6 去年同期：2026 年任何月份都沒有 2025 資料，誠實回報 yoy=null 而非假造 0", async () => {
    const result = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    assert.equal(result.yoy, null);
    assert.ok(result.yoyReason && result.yoyReason.length > 0);
});

test("需求6 月環比：demo 租戶跟真實租戶資料互相隔離", async () => {
    const real = await getPeriodComparison({ tenantId: REAL_TENANT_ID, month: "2026-07" });
    const demo = await getPeriodComparison({ tenantId: DEMO_TENANT_ID, month: "2026-07" });
    assert.notEqual(real.current.revenueTotal, demo.current.revenueTotal);
});
