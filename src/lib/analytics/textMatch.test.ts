import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, fuzzyRank } from "./textMatch";

test("fuzzyScore: identical strings score 1", () => {
    assert.equal(fuzzyScore("五花肉", "五花肉"), 1);
});

test("fuzzyScore: substring containment scores 0.85", () => {
    assert.equal(fuzzyScore("五花肉", "五花肉片"), 0.85);
    assert.equal(fuzzyScore("五花肉片", "五花肉"), 0.85);
});

test("fuzzyScore: completely unrelated strings score low", () => {
    assert.ok(fuzzyScore("五花肉", "高麗菜") < 0.3);
});

test("fuzzyScore: empty query or target scores 0", () => {
    assert.equal(fuzzyScore("", "五花肉"), 0);
    assert.equal(fuzzyScore("五花肉", ""), 0);
});

test("fuzzyScore: partial char overlap (neither is a substring of the other) scores mid-range, not a false full match", () => {
    // 「大骨」vs「大腸」只共用「大」一個字，不該被當成高分匹配
    const score = fuzzyScore("大骨", "大腸");
    assert.ok(score > 0 && score < 0.85, `expected partial overlap in (0, 0.85), got ${score}`);
});

test("fuzzyScore: 案例4 真實資料 — 黃曜曟 vs 曜曟 因為互為子字串觸發 containment 分支（跟聚類邏輯一致）", () => {
    // fuzzyScore 的 containment 判斷（t.includes(q) || q.includes(t)）在單字/短字場景
    // 會直接命中 0.85，這跟 anomalies.ts 的 clusterNameVariants 用同一種 containment
    // 概念抓「黃曜曟/曜曟」是同一組是一致的行為，不是 bug。
    assert.equal(fuzzyScore("曜曟", "黃曜曟"), 0.85);
});

test("fuzzyRank: sorts descending by score and applies threshold", () => {
    const candidates = ["五花肉", "五花", "高麗菜", "五花肉片"];
    const ranked = fuzzyRank("五花肉", candidates, (c) => c, 0.5);
    assert.ok(ranked.every((r) => r.score >= 0.5));
    for (let i = 1; i < ranked.length; i++) {
        assert.ok(ranked[i - 1].score >= ranked[i].score);
    }
    assert.ok(ranked.some((r) => r.item === "五花肉" && r.score === 1));
});
