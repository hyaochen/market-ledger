// Unit tests for bot/handlers/query pure helpers.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectQueryDate, isQueryIntent } from "./query";

// ── detectQueryDate ─────────────────────────────────────────────
test("detectQueryDate: 今天 → today", () => {
    const result = detectQueryDate("今天記了什麼");
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date, "should return Date");
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 昨天 → yesterday", () => {
    const result = detectQueryDate("昨天記了什麼");
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date);
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 前天 → day before yesterday (F6 fix)", () => {
    const result = detectQueryDate("前天記了啥");
    const expected = new Date();
    expected.setDate(expected.getDate() - 2);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date, "前天 should return a Date");
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 前天 alone also triggers", () => {
    const result = detectQueryDate("前天");
    const expected = new Date();
    expected.setDate(expected.getDate() - 2);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date);
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 最近 → 'recent'", () => {
    const result = detectQueryDate("最近記了什麼");
    assert.equal(result, "recent");
});

test("detectQueryDate: M/D format → specific date", () => {
    const result = detectQueryDate("6/10 記了什麼");
    assert.ok(result instanceof Date);
    assert.equal((result as Date).getMonth(), 5); // June = index 5
    assert.equal((result as Date).getDate(), 10);
});

test("detectQueryDate: non-query text → null", () => {
    assert.equal(detectQueryDate("肝連2.6台斤218"), null);
    assert.equal(detectQueryDate("潮州5000"), null);
});

// ── isQueryIntent ───────────────────────────────────────────────
test("isQueryIntent: 前天 alone → true (F6 fix)", () => {
    assert.equal(isQueryIntent("前天"), true);
});

test("isQueryIntent: 前天記了什麼 → true (F6 fix)", () => {
    assert.equal(isQueryIntent("前天記了什麼"), true);
});

test("isQueryIntent: 昨天 → true", () => {
    assert.equal(isQueryIntent("昨天"), true);
});

test("isQueryIntent: 今天記了什麼 → true", () => {
    assert.equal(isQueryIntent("今天記了什麼"), true);
});

test("isQueryIntent: 最近 → true", () => {
    assert.equal(isQueryIntent("最近"), true);
});

test("isQueryIntent: general text → false", () => {
    assert.equal(isQueryIntent("肝連2.6台斤218"), false);
    assert.equal(isQueryIntent("潮州5000"), false);
});
