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
