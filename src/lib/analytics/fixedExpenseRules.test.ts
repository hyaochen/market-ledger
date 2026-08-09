// T-ML-027：固定支出商業規則的單元測試（純函式，不吃 DB）+ Dictionary 查詢
// （唯讀，比照專案既有慣例可以打真實 docker-data/dev.db — 見 testFixtures.ts）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedCleaningFee, expectedWashFee, getFixedExpenseDictValues } from "./fixedExpenseRules";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

// weekdayUTC: 0=日 1=一 2=二 3=三 4=四 5=五 6=六

test("expectedCleaningFee: 屏東週一/三/五 = 220", () => {
    assert.equal(expectedCleaningFee("pingtung", 1), 220);
    assert.equal(expectedCleaningFee("pingtung", 3), 220);
    assert.equal(expectedCleaningFee("pingtung", 5), 220);
});

test("expectedCleaningFee: 屏東週二/四/六/日 = 110", () => {
    assert.equal(expectedCleaningFee("pingtung", 2), 110);
    assert.equal(expectedCleaningFee("pingtung", 4), 110);
    assert.equal(expectedCleaningFee("pingtung", 6), 110);
    assert.equal(expectedCleaningFee("pingtung", 0), 110);
});

test("expectedCleaningFee: 潮州固定 220，不管星期幾", () => {
    for (let w = 0; w <= 6; w++) {
        assert.equal(expectedCleaningFee("chaozhou", w), 220);
    }
});

test("expectedWashFee: 屏東固定 300，潮州固定 250", () => {
    assert.equal(expectedWashFee("pingtung"), 300);
    assert.equal(expectedWashFee("chaozhou"), 250);
});

test("getFixedExpenseDictValues: 真實企業租戶找得到清潔費(清潔費)/洗攤(EXP011)", async () => {
    const values = await getFixedExpenseDictValues(REAL_TENANT_ID);
    assert.ok(values);
    assert.equal(values!.cleaningValue, "清潔費");
    assert.equal(values!.washValue, "EXP011");
});

test("getFixedExpenseDictValues: demo 租戶沒設這兩個支出類型 → null", async () => {
    const values = await getFixedExpenseDictValues(DEMO_TENANT_ID);
    assert.equal(values, null);
});
