import test from "node:test";
import assert from "node:assert/strict";
import { nextExpenseCode } from "./catalog-codes";

test("沒有任何項目從 EXP001 開始", () => {
    assert.equal(nextExpenseCode([]), "EXP001");
});

test("取最大編號 + 1，而不是筆數 + 1（刪掉中間一筆不會撞號）", () => {
    // 原本 EXP001..EXP003，刪掉 EXP002 後剩 2 筆：舊寫法會再產生 EXP003 而覆蓋
    assert.equal(nextExpenseCode(["EXP001", "EXP003"]), "EXP004");
});

test("非 EXP 格式的值被忽略，超過三位數照常進位", () => {
    assert.equal(nextExpenseCode(["RENT", "EXP999"]), "EXP1000");
});
