// Unit tests for bot/handlers/querySpec pure helpers（期間代碼是每顆按鈕的地基）.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    periodFromCode, periodFromOffset, periodForDay, periodForWeek, periodForYear,
    GROUPBYS_FOR, GROUPBY_LABEL, METRIC_LABEL,
} from "./querySpec";

const DAY = 86400000;

test("periodFromCode: d0 = 今天整天（from 00:00，to 隔天 00:00）", () => {
    const p = periodFromCode("d0")!;
    assert.ok(p);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    assert.equal(p.from.getTime(), now.getTime());
    assert.equal(p.to.getTime() - p.from.getTime(), DAY);
    assert.match(p.label, /今天/);
});

test("periodFromCode: d1 昨天、d2 前天 標籤與位移正確", () => {
    const d1 = periodFromCode("d1")!, d2 = periodFromCode("d2")!;
    assert.match(d1.label, /昨天/);
    assert.match(d2.label, /前天/);
    assert.equal(periodFromCode("d0")!.from.getTime() - d1.from.getTime(), DAY);
    assert.equal(d1.from.getTime() - d2.from.getTime(), DAY);
});

test("periodFromCode: m0 本月 / m1 上月 是整月且相鄰", () => {
    const m0 = periodFromCode("m0")!, m1 = periodFromCode("m1")!;
    assert.equal(m0.from.getDate(), 1);
    assert.equal(m0.to.getDate(), 1);
    assert.equal(m1.to.getTime(), m0.from.getTime(), "上月的 to 必須等於本月的 from");
    assert.match(m0.label, /^\d{4}年\d{1,2}月$/);
});

test("periodFromCode: w0 本週從週一開始、長 7 天；w1 上週緊接在前", () => {
    const w0 = periodFromCode("w0")!, w1 = periodFromCode("w1")!;
    assert.equal(w0.from.getDay(), 1, "本週起點應是週一");
    assert.equal(w0.to.getTime() - w0.from.getTime(), 7 * DAY);
    assert.equal(w1.to.getTime(), w0.from.getTime());
    assert.match(w0.label, /本週/);
    assert.match(w1.label, /上週/);
});

test("periodFromCode: y0 今年 / y1 去年", () => {
    const y0 = periodFromCode("y0")!, y1 = periodFromCode("y1")!;
    const thisYear = new Date().getFullYear();
    assert.equal(y0.from.getFullYear(), thisYear);
    assert.equal(y0.from.getMonth(), 0);
    assert.equal(y1.from.getFullYear(), thisYear - 1);
    assert.equal(y1.to.getTime(), y0.from.getTime());
});

test("periodFromCode: 壞代碼 → null，不會丟例外", () => {
    for (const bad of ["", "x0", "m", "mm1", "d-1", "q:m0", "0"]) {
        assert.equal(periodFromCode(bad), null, `「${bad}」應為 null`);
    }
});

test("period helpers 與 periodFromCode 一致", () => {
    assert.equal(periodFromCode("m2")!.from.getTime(), periodFromOffset(2).from.getTime());
    assert.equal(periodFromCode("d3")!.from.getTime(), periodForDay(3).from.getTime());
    assert.equal(periodFromCode("w2")!.from.getTime(), periodForWeek(2).from.getTime());
    assert.equal(periodFromCode("y2")!.from.getTime(), periodForYear(2).from.getTime());
});

test("GROUPBYS_FOR：每個指標的切法都有顯示名；entries 不提供無意義切法", () => {
    for (const [metric, groups] of Object.entries(GROUPBYS_FOR)) {
        assert.ok(METRIC_LABEL[metric as keyof typeof METRIC_LABEL], `metric ${metric} 缺顯示名`);
        for (const g of groups) assert.ok(GROUPBY_LABEL[g], `groupBy ${g} 缺顯示名`);
    }
    assert.ok(!GROUPBYS_FOR.entries.includes("vendor"));
    assert.ok(GROUPBYS_FOR.expense.includes("note"), "支出必須有「依人」——媽媽第三高頻的問題");
    assert.ok(GROUPBYS_FOR.revenue.includes("day"), "營業額必須有「每日」——owner 明確要的");
});
