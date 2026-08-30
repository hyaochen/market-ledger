import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPurchaseCategory, scoreCategoryAffinity } from "./classifyPurchase";
import { REAL_TENANT_ID } from "./testFixtures";

test("需求8 進貨分類：既有品項名稱完全相符 → exact-catalog, confidence 1", async () => {
    const r = await classifyPurchaseCategory(REAL_TENANT_ID, "五花肉");
    assert.equal(r.method, "exact-catalog");
    assert.equal(r.confidence, 1);
    assert.equal(r.categoryName, "肉類");
});

test("需求8 進貨分類：模糊比對（例如帶量詞後綴的變體）→ fuzzy-catalog", async () => {
    const r = await classifyPurchaseCategory(REAL_TENANT_ID, "五花肉片"); // 不在目錄裡，但包含「五花肉」
    assert.equal(r.method, "fuzzy-catalog");
    assert.equal(r.categoryName, "肉類");
    assert.ok(r.confidence > 0.5);
});

test("需求8 進貨分類：全新名稱（不在目錄、也無法模糊比對）落到 char-affinity 或 unknown，不硬猜高信心", async () => {
    const r = await classifyPurchaseCategory(REAL_TENANT_ID, "全新測試品項名稱九九九");
    assert.ok(r.method === "char-affinity" || r.method === "unknown");
    assert.ok(r.confidence < 0.7, "弱訊號分類信心度不該高過 0.7");
});

test("需求8 進貨分類：空字串輸入回傳 unknown 不丟錯", async () => {
    const r = await classifyPurchaseCategory(REAL_TENANT_ID, "   ");
    assert.equal(r.method, "unknown");
    assert.equal(r.categoryId, null);
});

test("scoreCategoryAffinity（純函式）：字元組成偏向哪個分類就給哪個分類較高分", () => {
    const byCategory = new Map<string, string[]>([
        ["meat", ["五花肉", "大腸", "豬耳", "蹄膀"]],
        ["veg", ["高麗菜", "紅蘿蔔", "白蘿蔔", "蔥"]],
    ]);
    const scores = scoreCategoryAffinity("蘿蔔絲", byCategory);
    assert.ok((scores.get("veg") ?? 0) > (scores.get("meat") ?? 0));
});
