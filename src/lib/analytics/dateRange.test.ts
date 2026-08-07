import { test } from "node:test";
import assert from "node:assert/strict";
import {
    utcDate,
    parseISODateUTC,
    isoDateKeyUTC,
    monthKeyUTC,
    getWeekdayUTC,
    addDaysUTC,
    addMonthsUTC,
    dayRangeUTC,
    monthRangeUTC,
    resolveRange,
} from "./dateRange";

test("utcDate: builds UTC midnight regardless of host timezone", () => {
    const d = utcDate(2026, 7, 1);
    assert.equal(d.toISOString(), "2026-07-01T00:00:00.000Z");
});

test("parseISODateUTC: valid date parses to UTC midnight", () => {
    const d = parseISODateUTC("2026-07-31");
    assert.equal(d?.toISOString(), "2026-07-31T00:00:00.000Z");
});

test("parseISODateUTC: rejects malformed / rollover dates", () => {
    assert.equal(parseISODateUTC("2026-02-30"), null); // Feb has no 30th
    assert.equal(parseISODateUTC("not-a-date"), null);
    assert.equal(parseISODateUTC(null), null);
    assert.equal(parseISODateUTC(""), null);
});

test("isoDateKeyUTC / monthKeyUTC: round-trip formatting", () => {
    const d = utcDate(2026, 1, 5);
    assert.equal(isoDateKeyUTC(d), "2026-01-05");
    assert.equal(monthKeyUTC(d), "2026-01");
});

test("getWeekdayUTC: 2026-07-01 is a Wednesday (3)", () => {
    // 已用真實稽核資料核對：7/1 星期三（見 2026-07_expense-audit.md）
    assert.equal(getWeekdayUTC(utcDate(2026, 7, 1)), 3);
});

test("getWeekdayUTC: 2026-07-20 is a Monday (1) — 「終身」異常那天", () => {
    assert.equal(getWeekdayUTC(utcDate(2026, 7, 20)), 1);
});

test("addDaysUTC: crosses month boundary correctly", () => {
    const d = addDaysUTC(utcDate(2026, 7, 31), 1);
    assert.equal(isoDateKeyUTC(d), "2026-08-01");
});

test("addMonthsUTC: clamps day when target month is shorter", () => {
    const d = addMonthsUTC(utcDate(2026, 1, 31), 1); // Jan 31 + 1 month, Feb has 28 days (2026 not leap)
    assert.equal(isoDateKeyUTC(d), "2026-02-28");
});

test("addMonthsUTC: negative delta goes backwards", () => {
    const d = addMonthsUTC(utcDate(2026, 7, 15), -1);
    assert.equal(isoDateKeyUTC(d), "2026-06-15");
});

test("dayRangeUTC: single day boundary is exactly 24h", () => {
    const range = dayRangeUTC(utcDate(2026, 7, 20));
    assert.equal(range.gte.toISOString(), "2026-07-20T00:00:00.000Z");
    assert.equal(range.lt.toISOString(), "2026-07-21T00:00:00.000Z");
});

test("monthRangeUTC: July 2026 is [7/1, 8/1)", () => {
    const range = monthRangeUTC(2026, 7);
    assert.equal(range.gte.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(range.lt.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("resolveRange: explicit from/to inclusive both ends", () => {
    const r = resolveRange("2026-07-01", "2026-07-31");
    assert.equal(r.fromKey, "2026-07-01");
    assert.equal(r.toKey, "2026-07-31");
    assert.equal(r.gte.toISOString(), "2026-07-01T00:00:00.000Z");
    assert.equal(r.lt.toISOString(), "2026-08-01T00:00:00.000Z"); // exclusive upper bound = 8/1
});

test("resolveRange: swapped from/to still produces a valid ascending range", () => {
    const r = resolveRange("2026-07-31", "2026-07-01");
    assert.equal(r.fromKey, "2026-07-01");
    assert.equal(r.toKey, "2026-07-31");
});
