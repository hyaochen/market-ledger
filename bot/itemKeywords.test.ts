// T-ML-018：bot/itemKeywords 模組單元測試
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ITEM_KEYWORDS,
    detectItemKeyword,
    isCanonicalItemKeywordName,
    maskKeywordsForLlm,
    stripCanonicalNumericNames,
} from "./itemKeywords";

test("ITEM_KEYWORDS: 5 個 owner 自訂 SKU 都在表內", () => {
    const codes = ITEM_KEYWORDS.map(k => k.code);
    assert.deepEqual(codes, [
        "16-1203G",
        "16-1600G",
        "16-1601G",
        "18-1101G",
        "20-0023G",
    ]);
});

test("detectItemKeyword: 中文 keyword substring 比對", () => {
    assert.equal(detectItemKeyword("我今天進了 5 包味精")?.itemName, "味鮮A");
    assert.equal(detectItemKeyword("5 包滷包 300")?.itemName, "滷包香料");
    assert.equal(detectItemKeyword("3 包滷汁粉")?.itemName, "滷汁粉");
});

test("detectItemKeyword: 數字 keyword 用 word boundary", () => {
    assert.equal(detectItemKeyword("進 5 包 1600")?.itemName, "大骨高湯1600");
    assert.equal(detectItemKeyword("1601 3 包")?.itemName, "大骨高湯1601");
});

test("detectItemKeyword: 數字 keyword 不誤命中較長數字", () => {
    // 「16004」內的 1600 不應被當作 keyword 命中
    assert.equal(detectItemKeyword("肝連 16004 元"), null);
    // 「21601」內的 1601 同理
    assert.equal(detectItemKeyword("21601"), null);
});

test("detectItemKeyword: 完全沒命中 → null", () => {
    assert.equal(detectItemKeyword("肝連 2.6 台斤 218"), null);
    assert.equal(detectItemKeyword(""), null);
    assert.equal(detectItemKeyword(null), null);
    assert.equal(detectItemKeyword(undefined), null);
});

test("isCanonicalItemKeywordName: 標準品項名稱判斷", () => {
    assert.equal(isCanonicalItemKeywordName("味鮮A"), true);
    assert.equal(isCanonicalItemKeywordName("大骨高湯1600"), true);
    assert.equal(isCanonicalItemKeywordName("大骨高湯1601"), true);
    assert.equal(isCanonicalItemKeywordName("滷包香料"), true);
    assert.equal(isCanonicalItemKeywordName("滷汁粉"), true);
    assert.equal(isCanonicalItemKeywordName("肝連"), false);
    assert.equal(isCanonicalItemKeywordName(""), false);
    assert.equal(isCanonicalItemKeywordName(null), false);
});

test("maskKeywordsForLlm: 中文 keyword 置換", () => {
    assert.equal(maskKeywordsForLlm("我今天進了 5 包味精"), "我今天進了 5 包味鮮A");
    assert.equal(maskKeywordsForLlm("3 包滷包 100"), "3 包滷包香料 100");
    // 滷汁粉 vs 滷包：滷汁粉應該整段命中，不會被滷包→滷包香料 切斷
    assert.equal(maskKeywordsForLlm("滷汁粉"), "滷汁粉");
});

test("maskKeywordsForLlm: 數字 keyword 置換 + 保留 word boundary", () => {
    assert.equal(maskKeywordsForLlm("5 包 1600"), "5 包 大骨高湯1600");
    assert.equal(maskKeywordsForLlm("1601 3 包"), "大骨高湯1601 3 包");
    // 較長數字內的子字串不被切碎
    assert.equal(maskKeywordsForLlm("16004"), "16004");
    assert.equal(maskKeywordsForLlm("21601"), "21601");
});

test("maskKeywordsForLlm: 多 keyword 同一行混用", () => {
    assert.equal(
        maskKeywordsForLlm("味精 1600 滷包"),
        "味鮮A 大骨高湯1600 滷包香料",
    );
});

test("maskKeywordsForLlm: 沒 keyword → 原樣回傳", () => {
    assert.equal(maskKeywordsForLlm("肝連 2.6 台斤 218"), "肝連 2.6 台斤 218");
    assert.equal(maskKeywordsForLlm(""), "");
});

test("stripCanonicalNumericNames: 把 mask 後的 大骨高湯1600/1601 整段移除", () => {
    assert.equal(
        stripCanonicalNumericNames("進 5 包大骨高湯1600 300"),
        "進 5 包 300",
    );
    assert.equal(
        stripCanonicalNumericNames("大骨高湯1601"),
        "",
    );
});

test("stripCanonicalNumericNames: 非數字 keyword 標準名不移除", () => {
    // 「味鮮A」「滷包香料」「滷汁粉」非數字 SKU 應該保留
    assert.equal(
        stripCanonicalNumericNames("5 包味鮮A 300"),
        "5 包味鮮A 300",
    );
    assert.equal(
        stripCanonicalNumericNames("3 包滷包香料"),
        "3 包滷包香料",
    );
});
