import test from "node:test";
import assert from "node:assert/strict";
import {
    appendRevenueNote,
    checkCashTotalLimits,
    checkExpenseLimits,
    checkTotalSalesPositive,
    dedupeChecklist,
    parseDenomMap,
    parseSaneCashDate,
    validateSignatureDataUrl,
    CASH_BOX_TOTAL_MAX,
    EXPENSE_ROW_AMOUNT_MAX,
    EXPENSE_ROWS_MAX,
    EXPENSES_TOTAL_MAX,
    MAX_DENOM_COUNT,
    MAX_SIGNATURE_LENGTH,
    REVENUE_NOTE_MAX,
    RESERVE_TOTAL_MAX,
    SALES_TOTAL_MAX,
} from "./cash-validate";
import { CASH_BOX_DENOMS, CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL, SALES_DENOMS } from "./cash-constants";

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
    for (const bad of [-1, 1.5, Number.NaN, Infinity, 5_001, "3", null]) {
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

// ---------- 上限 ----------

test("上限常數：合計上限至少是目標值的 10 倍；單面額張數 5000", () => {
    assert.equal(MAX_DENOM_COUNT, 5_000);
    assert.ok(CASH_BOX_TOTAL_MAX >= CASH_BOX_TARGET_TOTAL * 10);
    assert.ok(RESERVE_TOTAL_MAX >= RESERVE_TARGET_TOTAL * 10);
    assert.ok(SALES_TOTAL_MAX > 0);
});

test("parseDenomMap: 張數剛好 5000 通過、5001 被拒", () => {
    assert.equal(parseDenomMap({ "5": 5000 }, CASH_BOX_DENOMS, "錢盒").ok, true);
    const r = parseDenomMap({ "5": 5001 }, CASH_BOX_DENOMS, "錢盒");
    assert.equal(r.ok, false);
});

test("checkCashTotalLimits: 剛好等於上限通過，超過被拒並說明哪一項與上限", () => {
    const ok = { cashBoxTotal: CASH_BOX_TOTAL_MAX, reserveTotal: RESERVE_TOTAL_MAX, salesTotal: SALES_TOTAL_MAX };
    assert.equal(checkCashTotalLimits(ok), null);
    assert.match(checkCashTotalLimits({ ...ok, cashBoxTotal: CASH_BOX_TOTAL_MAX + 1 }) ?? "", /錢盒合計.*500,000/);
    assert.match(checkCashTotalLimits({ ...ok, reserveTotal: RESERVE_TOTAL_MAX + 1 }) ?? "", /備用金合計.*500,000/);
    assert.match(checkCashTotalLimits({ ...ok, salesTotal: SALES_TOTAL_MAX + 1 }) ?? "", /營業現金合計.*500,000/);
});

test("checkExpenseLimits: 單列、合計、列數上限", () => {
    assert.equal(checkExpenseLimits([]), null);
    assert.equal(checkExpenseLimits([{ amount: EXPENSE_ROW_AMOUNT_MAX }]), null);
    assert.match(checkExpenseLimits([{ amount: EXPENSE_ROW_AMOUNT_MAX + 1 }]) ?? "", /單筆支出.*100,000/);
    // 合計剛好 200,000（2 列各 100,000）通過；再多 1 元被拒
    assert.equal(checkExpenseLimits([{ amount: 100_000 }, { amount: 100_000 }]), null);
    assert.match(checkExpenseLimits([{ amount: 100_000 }, { amount: 100_000 }, { amount: 1 }]) ?? "", /支出合計.*200,000/);
    assert.equal(EXPENSES_TOTAL_MAX, 200_000);
    // 列數：50 列（每列 1 元）通過，51 列被拒
    assert.equal(checkExpenseLimits(Array.from({ length: EXPENSE_ROWS_MAX }, () => ({ amount: 1 }))), null);
    assert.match(checkExpenseLimits(Array.from({ length: EXPENSE_ROWS_MAX + 1 }, () => ({ amount: 1 }))) ?? "", /最多 50 列/);
});

test("checkTotalSalesPositive: 0 與負數被拒，正數通過", () => {
    assert.ok(checkTotalSalesPositive(0));
    assert.ok(checkTotalSalesPositive(-5));
    assert.ok(checkTotalSalesPositive(Number.NaN));
    assert.equal(checkTotalSalesPositive(1), null);
});

// ---------- 簽名 ----------

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const png = (b = PNG_HEAD) => `data:image/png;base64,${b.toString("base64")}`;

test("validateSignatureDataUrl: 合法 PNG / JPEG（jpg 視同 jpeg）", () => {
    assert.deepEqual(validateSignatureDataUrl(png()), { ok: true, mime: "image/png" });
    assert.deepEqual(validateSignatureDataUrl(`data:image/jpeg;base64,${JPG_HEAD.toString("base64")}`), { ok: true, mime: "image/jpeg" });
    assert.deepEqual(validateSignatureDataUrl(`data:image/jpg;base64,${JPG_HEAD.toString("base64")}`), { ok: true, mime: "image/jpeg" });
});

test("validateSignatureDataUrl: 宣告 PNG 但內容是別的（HTML、JPEG）被拒", () => {
    assert.equal(validateSignatureDataUrl(png(Buffer.from("<script>alert('x')</script>"))).ok, false);
    assert.equal(validateSignatureDataUrl(png(JPG_HEAD)).ok, false);
    assert.equal(validateSignatureDataUrl(`data:image/jpeg;base64,${PNG_HEAD.toString("base64")}`).ok, false);
});

test("validateSignatureDataUrl: 非 base64 字元、長度不合法、結尾亂塞被拒", () => {
    const body = PNG_HEAD.toString("base64");
    assert.equal(validateSignatureDataUrl(`data:image/png;base64,${body}<script>`).ok, false);
    assert.equal(validateSignatureDataUrl(`data:image/png;base64,${body} AAAA`).ok, false);
    assert.equal(validateSignatureDataUrl(`data:image/png;base64,${body}A`).ok, false); // 長度不是 4 的倍數
    assert.equal(validateSignatureDataUrl(`data:image/png;base64,${body}
AAAA`).ok, false);
    assert.equal(validateSignatureDataUrl(`data:image/png;base64,${body}=AAA`).ok, false); // = 只能在結尾
});

test("validateSignatureDataUrl: 其他 data URL、SVG、空字串、非字串、超長被拒", () => {
    assert.equal(validateSignatureDataUrl("data:text/html;base64,PGh0bWw+").ok, false);
    assert.equal(validateSignatureDataUrl(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`).ok, false);
    assert.equal(validateSignatureDataUrl("").ok, false);
    assert.equal(validateSignatureDataUrl(null).ok, false);
    assert.equal(validateSignatureDataUrl(12345).ok, false);
    assert.equal(validateSignatureDataUrl("data:image/png;base64,").ok, false);
    const filler = "A".repeat(MAX_SIGNATURE_LENGTH); // 加上前綴後超過上限
    const tooLong = validateSignatureDataUrl(png() + filler);
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.match(tooLong.error, /過大/);
});

test("validateSignatureDataUrl: 長度剛好等於上限通過", () => {
    const prefix = "data:image/png;base64,";
    const head = Buffer.concat([PNG_HEAD, Buffer.from([0, 0])]).toString("base64"); // 18 bytes -> 24 字元、無 = 補位
    const room = MAX_SIGNATURE_LENGTH - prefix.length - head.length;
    const padLen = room - (room % 4); // base64 長度必須是 4 的倍數，取不超過上限的最大值
    assert.equal(validateSignatureDataUrl(prefix + head + "A".repeat(padLen)).ok, true);
    assert.equal(validateSignatureDataUrl(prefix + head + "A".repeat(padLen + 4)).ok, false);
    assert.equal(MAX_SIGNATURE_LENGTH, 600_000);
});

// ---------- 營收備註 ----------

test("appendRevenueNote: 第一次附加、同一句已在結尾不重複", () => {
    const m = "cash 清點修正 (alice)";
    const once = appendRevenueNote("原備註", m);
    assert.equal(once, `原備註 | ${m}`);
    assert.equal(appendRevenueNote(once, m), once);
    assert.equal(appendRevenueNote(null, m), m);
    assert.equal(appendRevenueNote(m, m), m);
});

test("appendRevenueNote: 不同人的標記照常附加，整串不超過上限且保留標記", () => {
    let note: string | null = "起始";
    for (let i = 0; i < 100; i++) note = appendRevenueNote(note, `cash 清點修正 (user${i})`);
    assert.ok((note ?? "").length <= REVENUE_NOTE_MAX);
    assert.ok((note ?? "").endsWith("cash 清點修正 (user99)"));
    // 既有超長備註也會被截斷
    assert.ok(appendRevenueNote("長".repeat(2000), "標記").length <= REVENUE_NOTE_MAX);
});
