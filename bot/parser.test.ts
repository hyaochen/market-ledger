// Unit tests for bot/parser pure helpers.
// Run: npm test  (uses node --test + tsx)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeNumbers,
    convertChineseNumbers,
    parseCnNumber,
    fixJinLiangFromRaw,
    fixNumbersFromRaw,
    detectDayOffEntries,
} from "./parser";

test("normalizeNumbers: comma-separated thousands", () => {
    assert.equal(normalizeNumbers("1,500"), "1500");
    assert.equal(normalizeNumbers("12,345"), "12345");
    assert.equal(normalizeNumbers("no numbers here"), "no numbers here");
});

test("normalizeNumbers: Chinese low-reversed-prime thousands", () => {
    assert.equal(normalizeNumbers("1ˋ500"), "1500");
    assert.equal(normalizeNumbers("2\u02CB500"), "2500");
});

test("parseCnNumber: basic digits", () => {
    assert.equal(parseCnNumber("一"), 1);
    assert.equal(parseCnNumber("兩"), 2);
    assert.equal(parseCnNumber("三"), 3);
    assert.equal(parseCnNumber("十"), 10);
});

test("parseCnNumber: teens (十X)", () => {
    assert.equal(parseCnNumber("十一"), 11);
    assert.equal(parseCnNumber("十二"), 12);
    assert.equal(parseCnNumber("十五"), 15);
});

test("parseCnNumber: 20-99 (X十Y)", () => {
    assert.equal(parseCnNumber("二十"), 20);
    assert.equal(parseCnNumber("二十五"), 25);
    assert.equal(parseCnNumber("九十九"), 99);
});

test("parseCnNumber: invalid input", () => {
    assert.equal(parseCnNumber("百"), null);
    assert.equal(parseCnNumber("甲乙"), null);
});

test("convertChineseNumbers: CN digit before unit", () => {
    assert.equal(convertChineseNumbers("兩斤"), "2斤");
    assert.equal(convertChineseNumbers("十二個"), "12個");
    assert.equal(convertChineseNumbers("五包"), "5包");
});

test("convertChineseNumbers: do not touch CN digits without unit", () => {
    // 品名中的中文字不該被改
    assert.equal(convertChineseNumbers("三節肉"), "三節肉");
    assert.equal(convertChineseNumbers("一般商品"), "一般商品");
});

test("fixJinLiangFromRaw: 2斤10兩 → quantity=210, unit=jl", () => {
    const result = fixJinLiangFromRaw({
        rawInput: "肝連2斤10兩250廠商海豐",
        quantity: 2,
        unit: "斤",
        price: 250,
    });
    assert.equal(result.quantity, 210);
    assert.equal(result.unit, "jl");
});

test("fixJinLiangFromRaw: 3斤5兩 → quantity=305", () => {
    const result = fixJinLiangFromRaw({
        rawInput: "肝連3斤5兩380",
        quantity: 3,
        unit: "斤",
        price: 380,
    });
    assert.equal(result.quantity, 305);
    assert.equal(result.unit, "jl");
});

test("fixJinLiangFromRaw: liang > 15 → skip (invalid 十六兩制)", () => {
    const result = fixJinLiangFromRaw({
        rawInput: "肝連2斤18兩500",
        quantity: 2,
        unit: "斤",
        price: 500,
    });
    // 兩 > 15 不轉換，保留原資料
    assert.equal(result.quantity, 2);
    assert.equal(result.unit, "斤");
});

test("fixJinLiangFromRaw: no jl pattern → unchanged", () => {
    const entry = {
        rawInput: "肝連2.6台斤218",
        quantity: 2.6,
        unit: "台斤",
        price: 218,
    };
    const result = fixJinLiangFromRaw(entry);
    assert.equal(result.quantity, 2.6);
    assert.equal(result.unit, "台斤");
});

test("fixNumbersFromRaw: standard purchase preserves qty+price", () => {
    const result = fixNumbersFromRaw({
        rawInput: "肝連2.6台斤218",
        quantity: 2.6,
        unit: "台斤",
        price: 218,
    });
    assert.equal(result.quantity, 2.6);
    assert.equal(result.price, 218);
});

test("fixNumbersFromRaw: LLM got wrong numbers → regex corrects", () => {
    // LLM 回傳錯的 qty/price，regex 從 rawInput 糾正
    const result = fixNumbersFromRaw({
        rawInput: "肝連2.6台斤218",
        quantity: 999, // LLM 錯
        unit: "台斤",
        price: 999,    // LLM 錯
    });
    assert.equal(result.quantity, 2.6);
    assert.equal(result.unit, "台斤");
    assert.equal(result.price, 218);
});

test("fixNumbersFromRaw: skip jl-encoded entries", () => {
    // 已被 fixJinLiangFromRaw 處理過的 jl 不該再被碰
    const entry = {
        rawInput: "肝連2斤10兩250",
        quantity: 210,
        unit: "jl" as const,
        price: 250,
    };
    const result = fixNumbersFromRaw(entry);
    assert.equal(result.quantity, 210);
    assert.equal(result.unit, "jl");
});

// ── detectDayOffEntries（T-ML-001 休假意圖預判）─────────────────────
const LOC_NAMES = ["屏東", "潮州"];
const TODAY = "2026-06-10";

test("detectDayOffEntries: 屏東今天休假 → REVENUE + isDayOff", () => {
    const result = detectDayOffEntries("屏東今天休假", TODAY, LOC_NAMES);
    assert.ok(result, "should match");
    assert.equal(result!.length, 1);
    const e = result![0];
    assert.equal(e.type, "REVENUE");
    assert.equal(e.isDayOff, true);
    assert.equal(e.price, 0);
    assert.equal(e.locationName, "屏東");
    assert.equal(e.date, TODAY);
});

test("detectDayOffEntries: 潮州 5/23 休假 → date overridden", () => {
    const result = detectDayOffEntries("潮州 5/23 休假", TODAY, LOC_NAMES);
    assert.ok(result);
    assert.equal(result!.length, 1);
    assert.equal(result![0].locationName, "潮州");
    assert.equal(result![0].date, "2026-05-23");
    assert.equal(result![0].isDayOff, true);
});

test("detectDayOffEntries: 公休 同義字也認", () => {
    const result = detectDayOffEntries("屏東 3月17日 公休", TODAY, LOC_NAMES);
    assert.ok(result);
    assert.equal(result![0].isDayOff, true);
    assert.equal(result![0].date, "2026-03-17");
});

test("detectDayOffEntries: 無休假字眼 → null", () => {
    assert.equal(detectDayOffEntries("潮州5000", TODAY, LOC_NAMES), null);
    assert.equal(detectDayOffEntries("肝連2.6台斤218", TODAY, LOC_NAMES), null);
});

test("detectDayOffEntries: 含金額混雜 → null（讓 LLM 處理）", () => {
    assert.equal(detectDayOffEntries("潮州5000\n屏東休假", TODAY, LOC_NAMES), null);
    assert.equal(detectDayOffEntries("潮州5000休假", TODAY, LOC_NAMES), null);
});

test("detectDayOffEntries: 無 location 提示 → 仍盡力抽取", () => {
    // 沒有 exact match 已知 location → 抽休假關鍵字前後的文字
    const result = detectDayOffEntries("測試攤位 今天休假", TODAY, LOC_NAMES);
    assert.ok(result);
    assert.equal(result![0].locationName, "測試攤位");
    assert.equal(result![0].isDayOff, true);
});

// ── T-ML-018：休息 keyword + note 公休 ──────────────────────────────────
test("detectDayOffEntries(T-ML-018): 休息 keyword 也認", () => {
    const result = detectDayOffEntries("潮州攤位休息", TODAY, LOC_NAMES);
    assert.ok(result, "「休息」應該命中");
    assert.equal(result!.length, 1);
    assert.equal(result![0].isDayOff, true);
    assert.equal(result![0].price, 0);
    assert.equal(result![0].type, "REVENUE");
});

test("detectDayOffEntries(T-ML-018): 備註欄填「{攤位名}公休」", () => {
    const r1 = detectDayOffEntries("潮州休息", TODAY, LOC_NAMES);
    assert.equal(r1![0].note, "潮州公休");

    const r2 = detectDayOffEntries("屏東休假", TODAY, LOC_NAMES);
    assert.equal(r2![0].note, "屏東公休");

    const r3 = detectDayOffEntries("屏東公休", TODAY, LOC_NAMES);
    assert.equal(r3![0].note, "屏東公休");
});

test("detectDayOffEntries(T-ML-018): 未知攤位 fallback 仍寫公休 note", () => {
    const result = detectDayOffEntries("中山攤位休息", TODAY, LOC_NAMES);
    assert.ok(result);
    // 「中山攤位」不在 LOC_NAMES，會走 cleaned-text fallback 抽出 "中山攤位"
    assert.equal(result![0].locationName, "中山攤位");
    assert.equal(result![0].note, "中山攤位公休");
});

// ── T-ML-018：keyword mask + strip 影響 fixNumbersFromRaw ────────────
test("fixNumbersFromRaw(T-ML-018): masked 「大骨高湯1600」內的 1600 不被當 price", () => {
    // pre-LLM mask 已把 "1600" 置換成 "大骨高湯1600"。
    // fixNumbersFromRaw 應該透過 stripCanonicalNumericNames 把整段拿掉，
    // 避免 1600 被誤抓為 price 覆寫 LLM 的 null
    const result = fixNumbersFromRaw({
        rawInput: "進 5 包大骨高湯1600",
        quantity: 5,
        unit: "包",
        price: undefined,
    });
    // 1600 不應該被當 price
    assert.notEqual(result.price, 1600);
    assert.equal(result.quantity, 5);
});

test("fixNumbersFromRaw(T-ML-018): 「大骨高湯1601」+ 額外 price 仍正確抽 price", () => {
    // owner 同時給金額：5 包大骨高湯1601 300
    const result = fixNumbersFromRaw({
        rawInput: "5 包大骨高湯1601 300",
        quantity: 5,
        unit: "包",
        price: undefined,
    });
    assert.equal(result.quantity, 5);
    assert.equal(result.price, 300);
});

// ── T-ML-022 Regression Fixtures ────────────────────────────────
// 真實生產失敗模式（個資已遮罩，pattern 保留）

// B1 fix verification
test("fixJinLiangFromRaw(B1): no rawInput → unchanged (shows why fallback is needed)", () => {
    // Without rawInput, JIN_LIANG_RE can't match, so entry is returned unchanged
    // Pre-B1-fix: parseEntries called fixJinLiangFromRaw before applying maskedText fallback,
    // causing 「1斤9兩」 to be missed when LLM omitted rawInput field
    const result = fixJinLiangFromRaw({
        quantity: 1.9, // LLM decimal notation for 1斤9兩 (no rawInput)
        unit: "斤兩",
        price: 140,
    });
    // Without rawInput, no conversion possible → unchanged
    assert.equal(result.quantity, 1.9);
    assert.equal(result.unit, "斤兩");
});

test("fixJinLiangFromRaw(B1): with maskedText fallback applied BEFORE call → correct extraction", () => {
    // Simulates post-B1-fix behavior:
    // parseEntries now does: e.rawInput ?? maskedText FIRST, then calls fixJinLiangFromRaw
    // Input: 「肝連1斤9兩140」; LLM output: {quantity:1.9, unit:"斤兩"} (no rawInput)
    // Fallback applied: rawInput set to maskedText = "肝連1斤9兩140"
    const entryWithFallback = {
        rawInput: "肝連1斤9兩140",
        quantity: 1.9,
        unit: "斤兩" as const,
        price: 140,
    };
    const result = fixJinLiangFromRaw(entryWithFallback);
    assert.equal(result.quantity, 109); // 1斤9兩 = 1*100 + 9 = 109
    assert.equal(result.unit, "jl");
});

test("fixNumbersFromRaw: 品號格式（F2/F3 pattern）不應被誤抓為 quantity", () => {
    // Production pattern: 「16-1600」型品號 + 箱數。品號本身含數字不應被誤識別為量詞
    // fixNumbersFromRaw 只看「數字+量詞」(QTY_UNIT_RE)，純數字品號串不匹配，行為正確
    const result = fixNumbersFromRaw({
        rawInput: "鮮味-A 一箱4500",
        quantity: 1,
        unit: "箱",
        price: 4500,
    });
    assert.equal(result.quantity, 1);
    assert.equal(result.unit, "箱");
    assert.equal(result.price, 4500);
});

test("detectDayOffEntries: 休息 + 前天日期模式（regression guard）", () => {
    // Ensure 前天 in a non-date-with-number format doesn't break day-off parser
    // (detectDayOffEntries only matches date pattern M/D or M月D號, not 前天)
    const result = detectDayOffEntries("屏東前天休假", TODAY, LOC_NAMES);
    // 應該命中（含休假 keyword），但日期可能抓不到前天（無 M/D 或 M月D號格式），fallback 到今日
    assert.ok(result, "should still match on 休假 keyword");
    assert.equal(result![0].isDayOff, true);
    assert.equal(result![0].locationName, "屏東");
    // 日期 fallback 到 TODAY（detectDayOffEntries 不解析「前天」相對詞）
    assert.equal(result![0].date, TODAY);
});
