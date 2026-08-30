// Unit tests for bot/handlers/query pure helpers.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    detectQueryDate, isQueryIntent, classifyQueryIntent,
    detectVendorMonthQuery, detectExpenseTypeMonthQuery,
    detectDailyRevenueQuery,
} from "./query";

// ── detectQueryDate ─────────────────────────────────────────────
test("detectQueryDate: 今天 → today", () => {
    const result = detectQueryDate("今天記了什麼");
    const expected = new Date();
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date, "should return Date");
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 昨天 → yesterday", () => {
    const result = detectQueryDate("昨天記了什麼");
    const expected = new Date();
    expected.setDate(expected.getDate() - 1);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date);
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 前天 → day before yesterday (F6 fix)", () => {
    const result = detectQueryDate("前天記了啥");
    const expected = new Date();
    expected.setDate(expected.getDate() - 2);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date, "前天 should return a Date");
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 前天 alone also triggers", () => {
    const result = detectQueryDate("前天");
    const expected = new Date();
    expected.setDate(expected.getDate() - 2);
    expected.setHours(0, 0, 0, 0);
    assert.ok(result instanceof Date);
    assert.equal((result as Date).toDateString(), expected.toDateString());
});

test("detectQueryDate: 最近 → 'recent'", () => {
    const result = detectQueryDate("最近記了什麼");
    assert.equal(result, "recent");
});

test("detectQueryDate: M/D format → specific date", () => {
    const result = detectQueryDate("6/10 記了什麼");
    assert.ok(result instanceof Date);
    assert.equal((result as Date).getMonth(), 5); // June = index 5
    assert.equal((result as Date).getDate(), 10);
});

test("detectQueryDate: non-query text → null", () => {
    assert.equal(detectQueryDate("肝連2.6台斤218"), null);
    assert.equal(detectQueryDate("潮州5000"), null);
});

// ── isQueryIntent ───────────────────────────────────────────────
test("isQueryIntent: 前天 alone → true (F6 fix)", () => {
    assert.equal(isQueryIntent("前天"), true);
});

test("isQueryIntent: 前天記了什麼 → true (F6 fix)", () => {
    assert.equal(isQueryIntent("前天記了什麼"), true);
});

test("isQueryIntent: 昨天 → true", () => {
    assert.equal(isQueryIntent("昨天"), true);
});

test("isQueryIntent: 今天記了什麼 → true", () => {
    assert.equal(isQueryIntent("今天記了什麼"), true);
});

test("isQueryIntent: 最近 → true", () => {
    assert.equal(isQueryIntent("最近"), true);
});

test("isQueryIntent: general text → false", () => {
    assert.equal(isQueryIntent("肝連2.6台斤218"), false);
    assert.equal(isQueryIntent("潮州5000"), false);
});

// ── classifyQueryIntent（2026-08-30 修復）──────────────────────────
// 回歸案例：owner 問「8/29 營收跟支出情況?」被判成記帳，ollama 憑空生出一筆營收。
test("classifyQueryIntent: 8/29 營收跟支出情況? → query（回歸案例）", () => {
    assert.equal(classifyQueryIntent("8/29 營收跟支出情況?"), "query");
});

test("classifyQueryIntent: 新補的營收/支出關鍵字 → query", () => {
    for (const t of ["8/29 營業額", "8/29 支出", "昨天收入", "8/29 進貨明細", "前天花費", "8/29業績"]) {
        assert.equal(classifyQueryIntent(t), "query", `「${t}」應判為查詢`);
    }
});

test("classifyQueryIntent: 原有關鍵字仍為 query", () => {
    assert.equal(classifyQueryIntent("8/29 記了什麼"), "query");
    assert.equal(classifyQueryIntent("昨天營收多少"), "query");
    assert.equal(classifyQueryIntent("前天"), "query");
});

// 關鍵回歸：補登舊帳是 owner 的主要流程，帶日期的記帳絕不能被攔下來多問一句
test("classifyQueryIntent: 帶日期的記帳（有數量/金額）→ entry，不得變成 ambiguous", () => {
    for (const t of ["8/13 頭皮2個240", "8/29 肝蓮2.6台斤218", "7/15 蠔油1箱1260", "8/6 潮州5000"]) {
        assert.equal(classifyQueryIntent(t), "entry", `「${t}」應直接走記帳`);
    }
});

test("classifyQueryIntent: 無日期的記帳 → entry", () => {
    assert.equal(classifyQueryIntent("肝連2.6台斤218"), "entry");
    assert.equal(classifyQueryIntent("頭皮一斤$120"), "entry");
});

// 有日期、沒關鍵字、日期以外沒有任何數字 → 問使用者，不猜
test("classifyQueryIntent: 意圖不明 → ambiguous", () => {
    assert.equal(classifyQueryIntent("8/29 頭皮"), "ambiguous");
    assert.equal(classifyQueryIntent("8/29 怎麼樣"), "ambiguous");
});

test("isQueryIntent 只在 query 時為 true（ambiguous 不算查詢）", () => {
    assert.equal(isQueryIntent("8/29 頭皮"), false);
    assert.equal(isQueryIntent("8/29 營收跟支出情況?"), true);
});

// ── detectVendorMonthQuery：必須對得上真實廠商（2026-08-30 修復）──────
const VENDORS = [
    { id: "v1", name: "海豐" },
    { id: "v2", name: "俊偉" },
    { id: "v3", name: "秀花" },
    { id: "v4", name: "建國滷蛋" },
    { id: "v5", name: "和生市場" },
];
const EXPENSE_TYPES = [
    { id: "e1", value: "薪資", label: "薪資" },
    { id: "e2", value: "清潔費", label: "清潔費" },
    { id: "e3", value: "EXP001", label: "租金" },
    { id: "e4", value: "gas", label: "瓦斯" },
];

test("detectVendorMonthQuery: 真實廠商 → 命中", () => {
    const r = detectVendorMonthQuery("8月海豐進了什麼", VENDORS);
    assert.ok(r, "「8月海豐進了什麼」應命中廠商查詢");
    assert.equal(r!.vendorName, "海豐");
    assert.equal(r!.month, 8);
});

// 回歸案例：這些以前全被誤判成廠商查詢，使用者只看到「找不到廠商「薪資」」
test("detectVendorMonthQuery: 非廠商字串 → null（讓後面的 detector 接手）", () => {
    for (const t of [
        "8月薪資", "8月薪水", "8月清潔費多少", "8月頭皮買了多少",
        "8月的薪水支出全部有多少", "8月肝連進了多少", "8月總共花多少",
    ]) {
        assert.equal(detectVendorMonthQuery(t, VENDORS), null, `「${t}」不該被判成廠商查詢`);
    }
});

test("detectVendorMonthQuery: 空廠商清單 → 一律 null，不再瞎猜", () => {
    assert.equal(detectVendorMonthQuery("8月海豐", []), null);
});

// ── detectExpenseTypeMonthQuery：白話同義詞（2026-08-30 新增）─────────
test("detectExpenseTypeMonthQuery: 薪水/工資 → 薪資", () => {
    for (const t of ["8月薪水", "8月的薪水支出全部有多少", "8月工資多少"]) {
        const r = detectExpenseTypeMonthQuery(t, EXPENSE_TYPES);
        assert.ok(r, `「${t}」應對到支出類型`);
        assert.equal(r!.expenseTypeLabel, "薪資", `「${t}」應對到薪資`);
    }
});

test("detectExpenseTypeMonthQuery: 房租 → 租金", () => {
    const r = detectExpenseTypeMonthQuery("8月房租多少", EXPENSE_TYPES);
    assert.ok(r);
    assert.equal(r!.expenseTypeLabel, "租金");
});

test("detectExpenseTypeMonthQuery: 原本就正確的用詞不受影響", () => {
    const r = detectExpenseTypeMonthQuery("8月薪資", EXPENSE_TYPES);
    assert.ok(r);
    assert.equal(r!.expenseTypeLabel, "薪資");
});

// ── detectDailyRevenueQuery（2026-08-30 新增）────────────────────
const LOCATIONS = [
    { id: "l1", name: "屏東攤位" },
    { id: "l2", name: "潮州攤位" },
];

test("detectDailyRevenueQuery: 每天 + 營業額 → 命中，無指定攤位", () => {
    for (const t of ["8月每天營業額", "8月營業額每天是多少", "本月每日營收"]) {
        const r = detectDailyRevenueQuery(t, LOCATIONS);
        assert.ok(r, `「${t}」應命中每日營業額`);
        assert.equal(r!.locationId, undefined, "未指定攤位時不應綁定地點");
    }
});

test("detectDailyRevenueQuery: 指定攤位（全名或簡稱皆可）", () => {
    const full = detectDailyRevenueQuery("8月屏東攤位每天營業額", LOCATIONS);
    assert.equal(full?.locationName, "屏東攤位");
    const short = detectDailyRevenueQuery("8月屏東每天", LOCATIONS);
    assert.equal(short?.locationName, "屏東攤位", "簡稱「屏東」也要對得上");
    const chao = detectDailyRevenueQuery("本月潮州每日營業額", LOCATIONS);
    assert.equal(chao?.locationName, "潮州攤位");
});

test("detectDailyRevenueQuery: 沒有「每天」→ null（交給整月查詢）", () => {
    assert.equal(detectDailyRevenueQuery("8月營業額", LOCATIONS), null);
    assert.equal(detectDailyRevenueQuery("8月屏東營業額", LOCATIONS), null);
});

test("detectDailyRevenueQuery: 有「每天」但無地點也無營收詞 → null", () => {
    assert.equal(detectDailyRevenueQuery("8月每天進了什麼", LOCATIONS), null);
});

test("detectDailyRevenueQuery: 沒有期間 → null", () => {
    assert.equal(detectDailyRevenueQuery("每天營業額", LOCATIONS), null);
});

// ── 支出類型重複 label 要全部帶上（租金＝rent/EXP001）──────────
test("detectExpenseTypeMonthQuery: 同 label 多 value → 回傳陣列", () => {
    const dup = [
        { id: "a", value: "rent", label: "租金" },
        { id: "b", value: "EXP001", label: "租金" },
        { id: "c", value: "薪資", label: "薪資" },
    ];
    const r = detectExpenseTypeMonthQuery("8月租金", dup);
    assert.ok(r);
    assert.ok(Array.isArray(r!.expenseTypeValue), "重複 label 應回傳所有 value");
    assert.deepEqual([...(r!.expenseTypeValue as string[])].sort(), ["EXP001", "rent"]);

    const single = detectExpenseTypeMonthQuery("8月薪資", dup);
    assert.equal(single!.expenseTypeValue, "薪資", "只有一個 value 時維持字串");
});
