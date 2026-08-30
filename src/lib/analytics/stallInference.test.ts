import { test } from "node:test";
import assert from "node:assert/strict";
import { inferStallFromNote, allCanonicalAliases, allKnownAliases, stallLabel } from "./stallInference";

test("inferStallFromNote: canonical 中山 → pingtung, confidence 1, not a typo", () => {
    const r = inferStallFromNote("中山");
    assert.equal(r.stall, "pingtung");
    assert.equal(r.confidence, 1);
    assert.equal(r.isKnownTypo, false);
});

test("inferStallFromNote: canonical 潮州 → chaozhou, confidence 1", () => {
    const r = inferStallFromNote("潮州");
    assert.equal(r.stall, "chaozhou");
    assert.equal(r.confidence, 1);
});

test("inferStallFromNote: 案例 5 — 「終身」是已知錯字變體 → pingtung, isKnownTypo=true", () => {
    // 這是 2026-07-20 洗攤那筆真實髒資料（應為「中山」打成「終身」）
    const r = inferStallFromNote("終身");
    assert.equal(r.stall, "pingtung");
    assert.equal(r.isKnownTypo, true);
    assert.ok(r.confidence > 0 && r.confidence < 1, "已知錯字信心度應該比乾淨寫法低，但不是 0");
});

test("inferStallFromNote: 潮洲/朝洲（同音錯字）都能對到 chaozhou 且標記為 typo", () => {
    for (const typo of ["潮洲", "朝洲"]) {
        const r = inferStallFromNote(typo);
        assert.equal(r.stall, "chaozhou", `"${typo}" 應該對到潮州`);
        assert.equal(r.isKnownTypo, true);
    }
});

test("inferStallFromNote: 完全無關的備註 → unknown, confidence 0", () => {
    const r = inferStallFromNote("測試");
    assert.equal(r.stall, "unknown");
    assert.equal(r.confidence, 0);
    assert.equal(r.matchedAlias, null);
});

test("inferStallFromNote: null/empty note → unknown（不猜測）", () => {
    assert.equal(inferStallFromNote(null).stall, "unknown");
    assert.equal(inferStallFromNote(undefined).stall, "unknown");
    assert.equal(inferStallFromNote("").stall, "unknown");
    assert.equal(inferStallFromNote("   ").stall, "unknown");
});

test("inferStallFromNote: 乾淨寫法優先於錯字（備註同時像兩種時不該被錯字搶走)", () => {
    // 「中山臨時工」同時包含乾淨的「中山」，應該直接判定 canonical，不會被任何 typo 別名蓋過
    const r = inferStallFromNote("中山臨時工");
    assert.equal(r.stall, "pingtung");
    assert.equal(r.isKnownTypo, false);
});

test("allCanonicalAliases / allKnownAliases: typo 清單是 canonical 清單的超集", () => {
    const canonical = allCanonicalAliases();
    const all = allKnownAliases();
    for (const alias of canonical) {
        assert.ok(all.includes(alias));
    }
    assert.ok(all.length > canonical.length, "應該還有額外的錯字變體");
});

test("stallLabel: unknown 回傳中文說明而非原始 code", () => {
    assert.equal(stallLabel("unknown"), "無法判斷");
    assert.equal(stallLabel("pingtung"), "中山");
    assert.equal(stallLabel("chaozhou"), "潮州");
});
