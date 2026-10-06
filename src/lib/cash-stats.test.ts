// T-ML-034：分析頁的純函式（趨勢資料樞紐、攤位顏色、軸標籤、日均標籤）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    NEUTRAL_SERIES_COLOR,
    STALL_SERIES_COLORS,
    averageLabel,
    buildTrend,
    endLabelsFit,
    formatAxisDate,
    formatAxisMoney,
    seriesColorForIndex,
    truncateLabel,
    type TrendRow,
} from "./cash-stats";

const PINGTUNG = { id: "loc_屏東", name: "屏東攤位" };
const CHAOZHOU = { id: "loc_潮州", name: "潮州攤位" };

function row(date: string, locationId: string, total: number, sales = total - 100, expenses = 100): TrendRow {
    return { date: new Date(`${date}T00:00:00.000Z`), locationId, totalSales: total, salesTotal: sales, expensesTotal: expenses };
}

test("seriesColorForIndex: 前四個攤位依序取分類色，超過就用中性灰（不循環、不生新色）", () => {
    assert.equal(seriesColorForIndex(0), STALL_SERIES_COLORS[0]);
    assert.equal(seriesColorForIndex(1), STALL_SERIES_COLORS[1]);
    assert.equal(seriesColorForIndex(3), STALL_SERIES_COLORS[3]);
    assert.equal(seriesColorForIndex(4), NEUTRAL_SERIES_COLOR);
    assert.equal(seriesColorForIndex(-1), NEUTRAL_SERIES_COLOR);
});

test("buildTrend: 同一天兩個攤位 → 一個日期、兩欄（不再有重複日期造成的鋸齒）", () => {
    const rows = [
        row("2026-10-04", PINGTUNG.id, 21350, 18570, 2780),
        row("2026-10-04", CHAOZHOU.id, 19415, 18255, 1160),
        row("2026-10-05", CHAOZHOU.id, 23520, 22900, 620),
    ];
    const { series, trend } = buildTrend(rows, [PINGTUNG, CHAOZHOU]);

    assert.deepEqual(series.map((s) => s.name), ["屏東攤位", "潮州攤位"]);
    assert.equal(trend.length, 2);
    assert.equal(trend[0].date, "2026-10-04");
    assert.deepEqual(trend[0].values[PINGTUNG.id], { total: 21350, sales: 18570, expenses: 2780 });
    assert.deepEqual(trend[0].values[CHAOZHOU.id], { total: 19415, sales: 18255, expenses: 1160 });
    // 10/05 屏東沒有清點：沒有這一欄，圖上會是缺口
    assert.equal(trend[1].values[PINGTUNG.id], undefined);
    assert.equal(trend[1].values[CHAOZHOU.id].total, 23520);
});

test("buildTrend: 日期由舊到新排序，不管輸入順序", () => {
    const rows = [
        row("2026-10-05", PINGTUNG.id, 100),
        row("2026-09-28", PINGTUNG.id, 200),
        row("2026-10-01", PINGTUNG.id, 300),
    ];
    const { trend } = buildTrend(rows, [PINGTUNG, CHAOZHOU]);
    assert.deepEqual(trend.map((p) => p.date), ["2026-09-28", "2026-10-01", "2026-10-05"]);
});

test("buildTrend: 顏色跟著攤位走——只剩潮州的資料時，潮州仍是第二個顏色（篩選不重漆）", () => {
    const onlyChaozhou = [row("2026-10-05", CHAOZHOU.id, 23520)];
    const { series } = buildTrend(onlyChaozhou, [PINGTUNG, CHAOZHOU]);
    assert.equal(series.length, 1);
    assert.equal(series[0].name, "潮州攤位");
    assert.equal(series[0].color, STALL_SERIES_COLORS[1]);
});

test("buildTrend: 完全沒有資料的攤位不會變成空系列", () => {
    const { series, trend } = buildTrend([], [PINGTUNG, CHAOZHOU]);
    assert.deepEqual(series, []);
    assert.deepEqual(trend, []);
});

test("buildTrend: 已停用的舊攤位只要有紀錄也要出現（呼叫端要傳全部攤位，含已停用）", () => {
    const stopped = { id: "loc_舊攤位", name: "舊攤位" };
    const rows = [row("2026-08-01", stopped.id, 5000)];
    const { series } = buildTrend(rows, [PINGTUNG, CHAOZHOU, stopped]);
    assert.deepEqual(series.map((s) => s.name), ["舊攤位"]);
    assert.equal(series[0].color, STALL_SERIES_COLORS[2]);
});

test("averageLabel: 單一攤位或只有一個攤位叫「日均」；兩個以上攤位混在一起叫「每攤每天平均」", () => {
    assert.equal(averageLabel(true, 2), "日均");
    assert.equal(averageLabel(false, 1), "日均");
    assert.equal(averageLabel(false, 2), "每攤每天平均");
    assert.equal(averageLabel(false, 0), "日均");
});

test("formatAxisMoney: 萬為單位，小於一萬直接用數字", () => {
    assert.equal(formatAxisMoney(0), "0");
    assert.equal(formatAxisMoney(5000), "5000");
    assert.equal(formatAxisMoney(10000), "1萬");
    assert.equal(formatAxisMoney(25000), "2.5萬");
    assert.equal(formatAxisMoney(40000), "4萬");
    assert.equal(formatAxisMoney(Number.NaN), "");
});

test("formatAxisDate: 2026-10-05 → 10/05", () => {
    assert.equal(formatAxisDate("2026-10-05"), "10/05");
    assert.equal(formatAxisDate("壞"), "壞");
});

test("truncateLabel: 中文名稱依字數截斷並補刪節號，短的原樣", () => {
    assert.equal(truncateLabel("大腸", 6), "大腸");
    assert.equal(truncateLabel("特價沙拉脫一大桶", 6), "特價沙拉脫一…");
    assert.equal(truncateLabel("剛好六個字喔", 6), "剛好六個字喔");
});

test("endLabelsFit: 兩條線終點太近就不畫直接標籤", () => {
    assert.equal(endLabelsFit([23000], 40000), true);
    assert.equal(endLabelsFit([20000, 30000], 40000), true); // 差 25% 的座標範圍
    assert.equal(endLabelsFit([21000, 22000], 40000), false); // 差 2.5%，會疊在一起
    assert.equal(endLabelsFit([1, 2], 0), false);
});
