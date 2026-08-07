import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToKgPrice } from "./priceNormalize";

test("normalizeToKgPrice: trusts standardWeight when present (bot / web write path already computed it)", () => {
    const r = normalizeToKgPrice({ totalPrice: 1000, standardWeight: 10, inputQuantity: 999, inputUnit: "catty" });
    assert.equal(r.pricePerKg, 100);
    assert.equal(r.basis, "standardWeight");
});

test("normalizeToKgPrice: recomputes from catty when standardWeight missing", () => {
    // 30 台斤 = 18kg（0.6 係數），1500 元 → 83.33 元/kg
    const r = normalizeToKgPrice({ totalPrice: 1500, standardWeight: null, inputQuantity: 30, inputUnit: "catty" });
    assert.equal(r.basis, "recomputed");
    assert.ok(r.pricePerKg != null && Math.abs(r.pricePerKg - 83.333) < 0.01);
});

test("normalizeToKgPrice: recomputes jl (斤兩十六兩制) from raw encoded quantity", () => {
    // 210 = 2 斤 10 兩 → (2 + 10/16) * 0.6 = 1.575 kg（跟 src/lib/units.ts jinLiangToKg 邏輯一致）
    const r = normalizeToKgPrice({ totalPrice: 315, standardWeight: null, inputQuantity: 210, inputUnit: "jl" });
    assert.equal(r.basis, "recomputed");
    assert.ok(r.kgWeight != null && Math.abs(r.kgWeight - 1.575) < 0.001);
    assert.ok(r.pricePerKg != null && Math.abs(r.pricePerKg - 200) < 0.01);
});

test("normalizeToKgPrice: count-based unit (個/包/箱…) cannot be weight-normalized → null, not a fake number", () => {
    const r = normalizeToKgPrice({ totalPrice: 500, standardWeight: null, inputQuantity: 10, inputUnit: "個" });
    assert.equal(r.pricePerKg, null);
    assert.equal(r.kgWeight, null);
    assert.equal(r.basis, null);
});

test("normalizeToKgPrice: kg unit, standardWeight missing, quantity zero → still null (no divide-by-zero garbage)", () => {
    const r = normalizeToKgPrice({ totalPrice: 100, standardWeight: 0, inputQuantity: 0, inputUnit: "kg" });
    assert.equal(r.pricePerKg, null);
});
