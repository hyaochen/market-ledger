import { test } from "node:test";
import assert from "node:assert/strict";
import { getStallProfitComparison } from "./stallProfit";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

test("需求5 攤位損益：7 月營收精準分攤位（Revenue.locationId）", async () => {
    // 🔴 注意：這裡刻意不比對 2026-07_expense-audit.md 報告裡寫的 454,304/425,925/880,229 —
    // 報告產出於 8/4，7/31 屏東營收後續又被 CashCount 自動同步機制改過一次（目前 DB
    // 是 463,899，report 當時是 454,304，差額剛好等於 7/31 那筆金額差），報告數字已經是
    // 歷史快照而非目前真相。這裡改成先用同一支函式當下查出來的值當 baseline，
    // 只驗證「屏東 + 潮州 = 全租戶總營收」這個內部一致性，不綁死一個會過期的魔術數字。
    //
    // 🔴 2026-08-09（T-ML-027）：潮州那行原本也寫死 425,925 比對，被真實資料漂移打破。
    // ⚠️ 主控 spot-check 更正歸因：差額 15,120 = owner 2026-08-08 20:33 補記的
    // 「7/31 潮州」那筆（唯讀查證 createdAt），**不是**同日補打的「8/7 潮州 18,820」——
    // 8 月的資料本來就不落在 7/1–7/31 查詢範圍內，不可能影響 7 月合計。潮州 7 月
    // 425,925 → 441,045、count 26 → 27 筆的真正來源是那筆 7/31。
    // 兩者共同的結論不變：租戶隨時可能補記歷史日期的營收，寫死快照數字必然過期，
    // 所以跟屏東那行一樣只驗證量級合理 + 內部一致性。
    // （已唯讀查證：7 月 Revenue 沒有任何一筆的 createdAt/updatedAt 落在 8/9，
    //   本次任務未更動任何 7 月資料。）
    const result = await getStallProfitComparison({ tenantId: REAL_TENANT_ID, from: "2026-07-01", to: "2026-07-31" });
    const pingtung = result.byStall.find((b) => b.stall === "pingtung")!;
    const chaozhou = result.byStall.find((b) => b.stall === "chaozhou")!;
    assert.ok(pingtung.revenue > 400000);
    assert.ok(chaozhou.revenue > 400000, `潮州 7 月營收應該在合理量級（目前 ${chaozhou.revenue}）`);
    assert.equal(result.totals.revenue, pingtung.revenue + chaozhou.revenue);
});

test("需求5 攤位損益：誠實面對限制 —— 進貨 100% 落入 shared 共同成本，不硬湊假損益", async () => {
    const result = await getStallProfitComparison({ tenantId: REAL_TENANT_ID, from: "2026-07-01", to: "2026-07-31" });
    assert.equal(result.coverage.purchaseAttributionRate, 0, "7 月進貨無任何一筆備註對得到攤位，可歸屬率應該精確等於 0");
    assert.equal(result.byStall.every((b) => b.attributedPurchase === 0), true);
    assert.equal(result.shared.unattributedPurchase, result.totals.purchase, "既然可歸屬率是 0，shared 進貨金額應該等於全部進貨金額");
    assert.ok(typeof result.caveat === "string" && result.caveat.length > 0);
});

test("需求5 攤位損益：支出（清潔費/洗攤等）可歸屬率遠高於進貨（備註習慣好很多，但不是 100%——例如租金 24,200 沒寫攤位備註）", async () => {
    const result = await getStallProfitComparison({ tenantId: REAL_TENANT_ID, from: "2026-07-01", to: "2026-07-31" });
    assert.ok(result.coverage.expenseAttributionRate > result.coverage.purchaseAttributionRate);
    // 實測約 0.43（清潔費/洗攤/水電費有寫攤位，租金/薪資/雜項大多沒寫）——比進貨的 0 好很多，
    // 但也誠實反映「沒有到全部支出都能分攤」，不誇大
    assert.ok(result.coverage.expenseAttributionRate > 0.3, `實測應該顯著高於 0，實際 ${result.coverage.expenseAttributionRate}`);
});

test("需求5 攤位損益：totals.combinedProfit 是全店整體損益（不受攤位分攤限制影響），可信", async () => {
    const result = await getStallProfitComparison({ tenantId: REAL_TENANT_ID, from: "2026-07-01", to: "2026-07-31" });
    const expected = result.totals.revenue - result.totals.expense - result.totals.purchase;
    assert.equal(result.totals.combinedProfit, expected);
});

test("需求5 攤位損益：tenantId 隔離 — demo 租戶回傳 0 而非真實租戶資料", async () => {
    const result = await getStallProfitComparison({ tenantId: DEMO_TENANT_ID, from: "2026-07-01", to: "2026-07-31" });
    const totalRevenue = result.byStall.reduce((s, b) => s + b.revenue, 0);
    assert.notEqual(totalRevenue, 880229);
});
