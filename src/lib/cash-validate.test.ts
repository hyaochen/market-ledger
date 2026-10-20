import test from "node:test";
import assert from "node:assert/strict";
import { dedupeChecklist, parseDenomMap, parseSaneCashDate } from "./cash-validate";
import { CASH_BOX_DENOMS, SALES_DENOMS } from "./cash-constants";

test("parseDenomMap: 合法面額算出合計並補齊缺的面額", () => {
    const r = parseDenomMap({ "500": 5, "100": 28 }, CASH_BOX_DENOMS, "錢盒");
    assert.ok(r.ok);
    if (r.ok) {
        assert.equal(r.total, 500 * 5 + 100 * 28);
        assert.deepEqual(r.map, { "500": 5, "100": 28, "50": 0, "10": 0, "5": 0 });
    }
});

test("parseDenomMap: 不認得的面額被拒絕（不是靜默忽略）", () => {
    const r = parseDenomMap({ "500": 1, "99999": 1 }, CASH_BOX_DENOMS, "錢盒");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /不認得的面額/);
    // 1000 元不在錢盒面額內，但在營業現金內
    assert.equal(parseDenomMap({ "1000": 1 }, CASH_BOX_DENOMS, "錢盒").ok, false);
    assert.equal(parseDenomMap({ "1000": 1 }, SALES_DENOMS, "營業現金").ok, true);
});

test("parseDenomMap: 負數、小數、非數字、天文數字都被拒絕", () => {
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 100_001, "3", null]) {
        assert.equal(parseDenomMap({ "500": bad }, CASH_BOX_DENOMS, "錢盒").ok, false, String(bad));
    }
});

test("parseDenomMap: 不是物件的輸入被拒絕", () => {
    assert.equal(parseDenomMap(null, CASH_BOX_DENOMS, "錢盒").ok, false);
    assert.equal(parseDenomMap([1, 2], CASH_BOX_DENOMS, "錢盒").ok, false);
});

test("parseSaneCashDate: 今天、昨天、時區誤差內的明天通過", () => {
    const now = new Date(2026, 9, 21, 12, 0, 0);
    assert.ok(parseSaneCashDate("2026-10-21", now));
    assert.ok(parseSaneCashDate("2026-10-20", now));
    assert.ok(parseSaneCashDate("2026-10-22", now));
});

test("parseSaneCashDate: 差好幾年、未來太遠、不存在的日期、格式錯誤都被拒絕", () => {
    const now = new Date(2026, 9, 21, 12, 0, 0);
    assert.equal(parseSaneCashDate("2020-01-01", now), null);
    assert.equal(parseSaneCashDate("2099-01-01", now), null);
    assert.equal(parseSaneCashDate("2026-10-24", now), null);
    assert.equal(parseSaneCashDate("2026-02-31", now), null);
    assert.equal(parseSaneCashDate("26-10-21", now), null);
    assert.equal(parseSaneCashDate("2026-10-21T00:00", now), null);
});

test("dedupeChecklist: 同一個 id 只留最後一筆", () => {
    assert.deepEqual(
        dedupeChecklist([{ id: "a", done: false }, { id: "b", done: true }, { id: "a", done: true }]),
        [{ id: "a", done: true }, { id: "b", done: true }],
    );
});
