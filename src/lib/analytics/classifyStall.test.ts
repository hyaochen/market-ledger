import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStall } from "./classifyStall";
import { REAL_TENANT_ID } from "./testFixtures";
import prisma from "@/lib/prisma";

test("需求10 攤位判斷：乾淨備註「中山」→ pingtung, confidence 1, method note-alias", async () => {
    const r = await classifyStall({ tenantId: REAL_TENANT_ID, note: "中山" });
    assert.equal(r.stall, "pingtung");
    assert.equal(r.confidence, 1);
    assert.equal(r.method, "note-alias");
});

test("需求10 攤位判斷：已知錯字「終身」→ pingtung 但 method 標記為 note-typo-alias（信心度較低）", async () => {
    const r = await classifyStall({ tenantId: REAL_TENANT_ID, note: "終身" });
    assert.equal(r.stall, "pingtung");
    assert.equal(r.method, "note-typo-alias");
    assert.ok(r.confidence < 1);
});

test("需求10 攤位判斷：🔴 誠實面對限制 —— 完全沒有備註、沒有廠商/品項可查時必須回 unknown，不准硬猜", async () => {
    const r = await classifyStall({ tenantId: REAL_TENANT_ID, note: null });
    assert.equal(r.stall, "unknown");
    assert.equal(r.confidence, 0);
    assert.equal(r.method, "insufficient-data");
});

test("需求10 攤位判斷：🔴 誠實面對限制 —— 進貨幾乎沒有攤位備註歷史，帶廠商但無備註時目前幾乎必然 insufficient-data", async () => {
    // 找一個真實有進貨紀錄的廠商，驗證目前資料現況下 vendor-history 這條路線量能不足
    const vendor = await prisma.vendor.findFirst({ where: { tenantId: REAL_TENANT_ID, name: "和生市場" } });
    assert.ok(vendor, "測試前提：和生市場這個廠商應該存在於真實租戶");
    const r = await classifyStall({ tenantId: REAL_TENANT_ID, note: null, vendorId: vendor!.id });
    // 這裡刻意不斷言死 'insufficient-data'，因為理論上未來資料變好可能會有 vendor-history 命中，
    // 而是斷言「不會因為沒證據就硬猜」—— 若真的推出攤位，confidence 必須合理反映樣本集中度
    if (r.stall !== "unknown") {
        assert.ok(r.confidence >= 0.8, "若真的給出攤位建議，信心度不該低於門檻卻硬猜");
    } else {
        assert.equal(r.confidence, 0);
    }
});

test("需求10 攤位判斷：備註優先於廠商/品項歷史（就算廠商有強烈歷史傾向，備註寫明的攤位還是準）", async () => {
    const vendor = await prisma.vendor.findFirst({ where: { tenantId: REAL_TENANT_ID } });
    const r = await classifyStall({ tenantId: REAL_TENANT_ID, note: "潮州", vendorId: vendor?.id });
    assert.equal(r.stall, "chaozhou");
    assert.equal(r.method, "note-alias");
});
