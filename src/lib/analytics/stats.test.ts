import { test } from "node:test";
import assert from "node:assert/strict";
import { median, mad, robustZScore } from "./stats";

test("median: odd-length array", () => {
    assert.equal(median([1, 3, 2]), 2);
});

test("median: even-length array averages middle two", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("mad: constant array has MAD 0", () => {
    assert.equal(mad([5, 5, 5, 5]), 0);
});

test("mad: matches hand-computed example", () => {
    // values [1,2,3,4,5], median=3, abs deviations [2,1,0,1,2], median of that = 1
    assert.equal(mad([1, 2, 3, 4, 5]), 1);
});

test("robustZScore: 五花肉 7/11 單價離群案例（真實資料重建）— 652 對比 220/240/220 應遠超閾值 3.5", () => {
    // 這組數字取自主控 2026-08-04 稽核（7/9=220, 7/11=652.13, 7/25=240, 7/31=220），已用唯讀查詢驗證
    const prices = [220, 652.13, 240, 220];
    const z = robustZScore(652.13, prices);
    assert.ok(Math.abs(z) >= 3.5, `expected |z|>=3.5, got ${z}`);
});

test("robustZScore: normal in-range value does not trigger outlier threshold", () => {
    const prices = [220, 240, 220, 230];
    const z = robustZScore(230, prices);
    assert.ok(Math.abs(z) < 3.5);
});

test("robustZScore: degenerate all-equal distribution doesn't crash and treats any deviation as flagged", () => {
    const z = robustZScore(999, [100, 100, 100]);
    assert.ok(Number.isFinite(z));
    assert.ok(Math.abs(z) > 0);
});

test("robustZScore: degenerate all-zero distribution returns 0 (can't judge, not garbage)", () => {
    const z = robustZScore(5, [0, 0, 0]);
    assert.equal(z, 0);
});
