import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExpenseType } from "./classifyExpense";
import { REAL_TENANT_ID } from "./testFixtures";

test("需求9 支出分類：label 完全相符 → exact, confidence 1", async () => {
    const r = await classifyExpenseType(REAL_TENANT_ID, "洗攤");
    assert.equal(r.method, "exact");
    assert.equal(r.value, "EXP011");
    assert.equal(r.confidence, 1);
});

test("需求9 支出分類：value 完全相符（value 本身就是中文字串的情況）也算 exact", async () => {
    const r = await classifyExpenseType(REAL_TENANT_ID, "清潔費");
    assert.equal(r.method, "exact");
    assert.equal(r.label, "清潔費");
});

test("需求9 支出分類：口語變體（瓦斯費 → 瓦斯）模糊比對成功", async () => {
    const r = await classifyExpenseType(REAL_TENANT_ID, "瓦斯費");
    assert.equal(r.method, "fuzzy");
    assert.equal(r.label, "瓦斯");
    assert.ok(r.confidence >= 0.5);
});

test("需求9 支出分類：完全無關文字回傳 unknown，附候選清單供人工判斷", async () => {
    const r = await classifyExpenseType(REAL_TENANT_ID, "完全不相關的亂數文字123");
    assert.equal(r.method, "unknown");
    assert.equal(r.value, null);
    assert.ok(Array.isArray(r.candidates));
});

test("需求9 支出分類：空字串輸入回傳 unknown 不丟錯", async () => {
    const r = await classifyExpenseType(REAL_TENANT_ID, "");
    assert.equal(r.method, "unknown");
});
