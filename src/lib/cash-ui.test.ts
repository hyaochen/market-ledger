// T-ML-034：cash 介面純函式（導覽 active、角色名稱、差額狀態、日期/星期、快速區間、輸入清洗）。
// 這些都是不碰 DB / React / DOM 的純函式，直接測。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CASH_NAV_ITEMS,
    NOTE_EMPTY_TEXT,
    activeAdminSubKey,
    activeNavKey,
    addDaysIso,
    countFlags,
    diffStatus,
    formatDateWithWeekday,
    formatMonthDayWeekday,
    formatNtd,
    formatNumber,
    formatTaipeiDateTime,
    formatTaipeiHHmm,
    hrefWithParams,
    identityLine,
    isSameRange,
    navItemsFor,
    normalizeCashPath,
    noteDisplay,
    quickRanges,
    resolveLocationFilter,
    roleLabel,
    sanitizeAmount,
    sanitizeCount,
    stepCount,
    todayLocalIsoDate,
    weekdayChar,
} from "./cash-ui";
import { CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL } from "./cash-constants";

// ── 角色 ─────────────────────────────────────────────────────

test("roleLabel: 管理者與清點員，介面不得出現英文 admin", () => {
    assert.equal(roleLabel(true), "管理者");
    assert.equal(roleLabel(false), "清點員");
    assert.ok(!/admin/i.test(roleLabel(true)));
});

test("identityLine: 「姓名 · 身分」；姓名剛好等於身分名稱（員工預設姓名「清點員」）時只顯示一次", () => {
    assert.equal(identityLine("洪怜俼", true), "洪怜俼 · 管理者");
    assert.equal(identityLine("王小明", false), "王小明 · 清點員");
    assert.equal(identityLine("清點員", false), "清點員");
    assert.equal(identityLine("管理者", true), "管理者");
    // 姓名是「清點員」但這個人是管理者：兩個詞不同，照常顯示兩段
    assert.equal(identityLine("清點員", true), "清點員 · 管理者");
});

// ── 導覽 ─────────────────────────────────────────────────────

test("navItemsFor: 員工 3 個（新增清點／歷史／帳號），管理者 5 個（多分析／管理）", () => {
    assert.deepEqual(navItemsFor(false).map((i) => i.label), ["新增清點", "歷史", "帳號"]);
    assert.deepEqual(navItemsFor(true).map((i) => i.label), ["新增清點", "歷史", "分析", "管理", "帳號"]);
});

test("navItemsFor: 管理者專屬項目的連結正確（分析=/cash/stats、管理=/cash/admin）", () => {
    const admin = navItemsFor(true);
    assert.equal(admin.find((i) => i.key === "stats")?.href, "/cash/stats");
    assert.equal(admin.find((i) => i.key === "admin")?.href, "/cash/admin");
    // 員工完全看不到這兩個
    assert.ok(!navItemsFor(false).some((i) => i.adminOnly));
    assert.equal(CASH_NAV_ITEMS.filter((i) => i.adminOnly).length, 2);
});

test("normalizeCashPath: 拿掉 /cash 前綴與結尾斜線，/cashier 這類相似路徑不能被誤剝", () => {
    assert.equal(normalizeCashPath("/cash"), "/");
    assert.equal(normalizeCashPath("/cash/"), "/");
    assert.equal(normalizeCashPath("/"), "/");
    assert.equal(normalizeCashPath("/cash/history/abc123"), "/history/abc123");
    assert.equal(normalizeCashPath("/history"), "/history");
    assert.equal(normalizeCashPath("/cash/history/"), "/history");
    assert.equal(normalizeCashPath("/cashier"), "/cashier");
    assert.equal(normalizeCashPath("/cash?from=2026-10-01"), "/");
});

test("activeNavKey: /cash 只在精確比對時是新增清點；history/**=歷史；stats=分析；admin/**=管理", () => {
    assert.equal(activeNavKey("/cash"), "entry");
    assert.equal(activeNavKey("/"), "entry"); // cash.* 子網域的 PWA start_url
    assert.equal(activeNavKey("/cash/history"), "history");
    assert.equal(activeNavKey("/cash/history/clx9abc"), "history");
    assert.equal(activeNavKey("/history"), "history"); // 子網域 rewrite 前的網址
    assert.equal(activeNavKey("/cash/stats"), "stats");
    assert.equal(activeNavKey("/cash/admin"), "admin");
    assert.equal(activeNavKey("/cash/admin/alerts"), "admin");
    assert.equal(activeNavKey("/cash/admin/checklist"), "admin");
    assert.equal(activeNavKey("/cash/account"), "account");
});

test("activeNavKey: 登入頁或不認識的路徑不會點亮任何項目", () => {
    assert.equal(activeNavKey("/cash/login"), null);
    assert.equal(activeNavKey("/cash/unknown"), null);
    // 前綴相似但不是同一段路徑
    assert.equal(activeNavKey("/cash/history-old"), null);
    assert.equal(activeNavKey("/cash/administrator"), null);
});

test("activeAdminSubKey: 分析／異常／動作清單各自 active；分析頁網址是 /cash/stats", () => {
    assert.equal(activeAdminSubKey("/cash/stats"), "stats");
    assert.equal(activeAdminSubKey("/cash/admin/alerts"), "alerts");
    assert.equal(activeAdminSubKey("/cash/admin/checklist"), "checklist");
    assert.equal(activeAdminSubKey("/cash/history"), null);
});

// ── 數字 / 差額 ──────────────────────────────────────────────

test("formatNumber / formatNtd: 固定千分位，非有限數字不炸", () => {
    assert.equal(formatNumber(1234567), "1,234,567");
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(Number.NaN), "0");
    assert.equal(formatNtd(38420), "NT$ 38,420");
});

test("diffStatus: 合計為 0 視為尚未填寫（不顯示差額）", () => {
    const s = diffStatus(0, CASH_BOX_TARGET_TOTAL);
    assert.equal(s.kind, "empty");
    assert.equal(s.diff, null);
    assert.equal(s.label, "尚未填寫");
});

test("diffStatus: 剛好等於目標 → 已平", () => {
    const s = diffStatus(CASH_BOX_TARGET_TOTAL, CASH_BOX_TARGET_TOTAL);
    assert.equal(s.kind, "balanced");
    assert.equal(s.diff, 0);
    assert.equal(s.label, "已平");
});

test("diffStatus: 多了顯示「差 +50」並附白話說明；少了顯示「差 -100」", () => {
    const over = diffStatus(RESERVE_TARGET_TOTAL + 50, RESERVE_TARGET_TOTAL);
    assert.equal(over.kind, "over");
    assert.equal(over.diff, 50);
    assert.equal(over.label, "差 +50");
    assert.equal(over.detail, "比目標多 50 元");

    const under = diffStatus(CASH_BOX_TARGET_TOTAL - 100, CASH_BOX_TARGET_TOTAL);
    assert.equal(under.kind, "under");
    assert.equal(under.diff, -100);
    assert.equal(under.label, "差 -100");
    assert.equal(under.detail, "比目標少 100 元");
});

test("diffStatus: 已存檔的紀錄（zeroIsEmpty=false）合計 0 照實跟目標比，不當成尚未填寫", () => {
    const s = diffStatus(0, CASH_BOX_TARGET_TOTAL, false);
    assert.equal(s.kind, "under");
    assert.equal(s.diff, -CASH_BOX_TARGET_TOTAL);
    assert.equal(s.label, `差 -${CASH_BOX_TARGET_TOTAL.toLocaleString("en-US")}`);
});

test("diffStatus: 大額差額要有千分位", () => {
    assert.equal(diffStatus(CASH_BOX_TARGET_TOTAL + 1200, CASH_BOX_TARGET_TOTAL).label, "差 +1,200");
    assert.equal(diffStatus(CASH_BOX_TARGET_TOTAL - 1500, CASH_BOX_TARGET_TOTAL).label, "差 -1,500");
});

test("countFlags: 錢盒與備用金都等於目標 → 沒有旗標（正常）", () => {
    assert.deepEqual(countFlags(CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL), []);
});

test("countFlags: 錢盒差額與備用金差額各自標出，標籤帶正負號", () => {
    const flags = countFlags(CASH_BOX_TARGET_TOTAL - 30, RESERVE_TARGET_TOTAL + 20);
    assert.deepEqual(flags.map((f) => f.kind), ["cashBox", "reserve"]);
    assert.deepEqual(flags.map((f) => f.label), ["錢盒差額 -30", "備用金差額 +20"]);
    assert.deepEqual(flags.map((f) => f.diff), [-30, 20]);
});

test("countFlags: 只有一邊有差額時只回一個旗標", () => {
    const flags = countFlags(CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL - 500);
    assert.equal(flags.length, 1);
    assert.equal(flags[0].label, "備用金差額 -500");
});

// ── 日期 ─────────────────────────────────────────────────────

test("weekdayChar: 已知日期的星期（2026-10-06 是星期二）", () => {
    assert.equal(weekdayChar("2026-10-06"), "二");
    assert.equal(weekdayChar("2026-10-05"), "一");
    assert.equal(weekdayChar("2026-10-04"), "日");
    assert.equal(weekdayChar("2026-10-10"), "六");
    assert.equal(weekdayChar("2028-02-29"), "二"); // 閏日
});

test("weekdayChar: 不合法的日期回 null（含會被 Date 進位的 2026-02-31）", () => {
    assert.equal(weekdayChar("2026-02-31"), null);
    assert.equal(weekdayChar("2026-13-01"), null);
    assert.equal(weekdayChar("今天"), null);
    assert.equal(weekdayChar(""), null);
});

test("formatDateWithWeekday / formatMonthDayWeekday: 台灣習慣的寫法，不合法原樣回傳", () => {
    assert.equal(formatDateWithWeekday("2026-10-05"), "2026年10月5日（一）");
    assert.equal(formatMonthDayWeekday("2026-10-05"), "10月5日（一）");
    assert.equal(formatMonthDayWeekday("2026-01-02"), "1月2日（五）");
    assert.equal(formatDateWithWeekday("不是日期"), "不是日期");
});

test("todayLocalIsoDate: 取的是本機時區的年月日，不是 UTC（跟 submitCashCount 的 parseLocalDate 同一套）", () => {
    // 用本機時區的建構子，所以無論測試機是什麼時區結果都一樣
    assert.equal(todayLocalIsoDate(new Date(2026, 9, 6, 23, 59, 59)), "2026-10-06");
    assert.equal(todayLocalIsoDate(new Date(2026, 0, 5, 0, 0, 0)), "2026-01-05");
});

test("formatTaipeiHHmm: 固定換成台北時間（UTC+8），跨日也正確", () => {
    assert.equal(formatTaipeiHHmm(new Date("2026-10-06T14:05:00Z")), "22:05");
    assert.equal(formatTaipeiHHmm(new Date("2026-10-06T00:00:00Z")), "08:00");
    assert.equal(formatTaipeiHHmm(new Date("2026-10-06T16:30:00Z")), "00:30"); // 台北已經是隔天凌晨
});

test("formatTaipeiDateTime: 台北時間的日期也跟著跨日", () => {
    assert.equal(formatTaipeiDateTime(new Date("2026-10-06T13:30:00Z")), "2026-10-06 21:30");
    assert.equal(formatTaipeiDateTime(new Date("2026-10-06T16:30:00Z")), "2026-10-07 00:30");
    assert.equal(formatTaipeiDateTime(new Date("2026-12-31T20:00:00Z")), "2027-01-01 04:00");
});

// ── 快速區間 ─────────────────────────────────────────────────

test("addDaysIso: 跨月、跨年、閏年", () => {
    assert.equal(addDaysIso("2026-03-01", -6), "2026-02-23");
    assert.equal(addDaysIso("2026-01-03", -6), "2025-12-28");
    assert.equal(addDaysIso("2028-03-01", -1), "2028-02-29");
    assert.equal(addDaysIso("2026-12-30", 3), "2027-01-02");
    assert.equal(addDaysIso("壞掉", 3), "壞掉");
});

test("quickRanges: 今天／近 7 天（含今天共 7 天）／本月（1 號到今天）", () => {
    const r = quickRanges("2026-10-06");
    assert.deepEqual(r.today, { from: "2026-10-06", to: "2026-10-06" });
    assert.deepEqual(r.last7, { from: "2026-09-30", to: "2026-10-06" });
    assert.deepEqual(r.thisMonth, { from: "2026-10-01", to: "2026-10-06" });
});

test("quickRanges: 月初那天，近 7 天會跨回上個月；本月只有一天", () => {
    const r = quickRanges("2026-03-01");
    assert.deepEqual(r.last7, { from: "2026-02-23", to: "2026-03-01" });
    assert.deepEqual(r.thisMonth, { from: "2026-03-01", to: "2026-03-01" });
});

test("quickRanges: 年初跨年", () => {
    const r = quickRanges("2027-01-03");
    assert.deepEqual(r.last7, { from: "2026-12-28", to: "2027-01-03" });
    assert.deepEqual(r.thisMonth, { from: "2027-01-01", to: "2027-01-03" });
});

test("isSameRange: 用來判斷快速區間按鈕是不是目前選中的那個", () => {
    const r = quickRanges("2026-10-06");
    assert.equal(isSameRange("2026-10-06", "2026-10-06", r.today), true);
    assert.equal(isSameRange("2026-09-30", "2026-10-06", r.today), false);
    assert.equal(isSameRange(undefined, undefined, r.today), false);
    assert.equal(isSameRange("2026-09-30", "2026-10-06", r.last7), true);
});

// ── 攤位篩選 ─────────────────────────────────────────────────

test("resolveLocationFilter: loc 參數必須是現有攤位，否則視為全部", () => {
    const locations = [{ id: "loc_屏東" }, { id: "loc_潮州" }];
    assert.equal(resolveLocationFilter("loc_潮州", locations), "loc_潮州");
    assert.equal(resolveLocationFilter("loc_不存在", locations), undefined);
    assert.equal(resolveLocationFilter("", locations), undefined);
    assert.equal(resolveLocationFilter(undefined, locations), undefined);
    assert.equal(resolveLocationFilter(null, locations), undefined);
});

test("hrefWithParams: 切換攤位時保留日期參數；選「全部」就把 loc 拿掉", () => {
    const params = { from: "2026-10-01", to: "2026-10-06", loc: "loc_屏東攤位" };
    assert.equal(
        hrefWithParams("/cash/history", params, { loc: "loc_潮州攤位" }),
        "/cash/history?from=2026-10-01&to=2026-10-06&loc=loc_%E6%BD%AE%E5%B7%9E%E6%94%A4%E4%BD%8D",
    );
    assert.equal(hrefWithParams("/cash/history", params, { loc: undefined }), "/cash/history?from=2026-10-01&to=2026-10-06");
    assert.equal(hrefWithParams("/cash/stats", { loc: "loc_x" }, { loc: "" }), "/cash/stats");
    assert.equal(hrefWithParams("/cash/stats", {}, {}), "/cash/stats");
});

// ── 輸入清洗 ─────────────────────────────────────────────────

test("sanitizeCount: 張數只留數字、去前導 0，負號與小數點都濾掉", () => {
    assert.equal(sanitizeCount("12"), "12");
    assert.equal(sanitizeCount("abc7"), "7");
    assert.equal(sanitizeCount("007"), "7");
    assert.equal(sanitizeCount("0"), "0");
    assert.equal(sanitizeCount("-3"), "3");
    assert.equal(sanitizeCount(""), "");
    assert.equal(sanitizeCount("５"), ""); // 全形數字不算（伺服器端要的是半形整數）
});

test("sanitizeAmount: 金額只留數字與一個小數點", () => {
    assert.equal(sanitizeAmount("250"), "250");
    assert.equal(sanitizeAmount("12.5"), "12.5");
    assert.equal(sanitizeAmount("1.2.3"), "1.23");
    assert.equal(sanitizeAmount("NT$ 300"), "300");
    assert.equal(sanitizeAmount("0123"), "123");
    assert.equal(sanitizeAmount(""), "");
});

test("stepCount: 加一減一、不會減到負數、空白再按減號維持空白", () => {
    assert.equal(stepCount("", 1), "1");
    assert.equal(stepCount("", -1), "");
    assert.equal(stepCount("5", 1), "6");
    assert.equal(stepCount("5", -1), "4");
    assert.equal(stepCount("1", -1), "0");
    assert.equal(stepCount("0", -1), "0");
});

// ── 備註顯示（T-ML-036：歷史列表與詳情，沒填也要看得到「無」）──────────

// 看不見的字元一律用碼位組出來：原始碼裡直接寫全形空白或零寬字元，人眼看不出來，編輯器與工具也可能把它吃掉。
const FULL_WIDTH_SPACE = String.fromCodePoint(0x3000);
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0);
const ZERO_WIDTH_ONLY = String.fromCodePoint(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff);

test("noteDisplay: 沒有備註（null、undefined、空字串）一律顯示「無」，並標成沒填", () => {
    assert.equal(NOTE_EMPTY_TEXT, "無");
    assert.deepEqual(noteDisplay(null), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay(undefined), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay(""), { text: "無", isEmpty: true });
});

test("noteDisplay: 只有空白（半形、tab、換行、全形空白、不換行空白）也算沒填", () => {
    assert.deepEqual(noteDisplay("   "), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay("\n\n"), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay("\t \r\n \t"), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay(FULL_WIDTH_SPACE.repeat(3)), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay(` ${FULL_WIDTH_SPACE}\n${NO_BREAK_SPACE}\n  `), { text: "無", isEmpty: true });
});

test("noteDisplay: 只有零寬字元（從別的 App 貼上時常夾帶）也算沒填，不然畫面上會是一格看不見的空白", () => {
    assert.deepEqual(noteDisplay(ZERO_WIDTH_ONLY), { text: "無", isEmpty: true });
    assert.deepEqual(noteDisplay(` ${ZERO_WIDTH_ONLY} \n`), { text: "無", isEmpty: true });
});

test("noteDisplay: 有內容就原文回傳，不顯示「無」", () => {
    assert.deepEqual(noteDisplay("今天下雨，客人比較少"), { text: "今天下雨，客人比較少", isEmpty: false });
    assert.deepEqual(noteDisplay("5 元硬幣不夠"), { text: "5 元硬幣不夠", isEmpty: false });
});

test("noteDisplay: 前後的空白與空行去掉，內部的換行與空白原樣保留", () => {
    assert.equal(noteDisplay("  \n今天下雨  \n").text, "今天下雨");
    assert.equal(noteDisplay("第一行\n\n第二行").text, "第一行\n\n第二行");
    assert.equal(noteDisplay("  收攤晚了十分鐘  \n  瓦斯桶換新  ").text, "收攤晚了十分鐘  \n  瓦斯桶換新");
    assert.equal(noteDisplay("上午下雨\r\n下午放晴").text, "上午下雨\r\n下午放晴");
    assert.equal(noteDisplay("  \n今天下雨  \n").isEmpty, false);
});

test("noteDisplay: 前後的全形空白也去掉（中文輸入法常打出來）", () => {
    assert.equal(noteDisplay(`${FULL_WIDTH_SPACE}今天下雨${FULL_WIDTH_SPACE}${FULL_WIDTH_SPACE}`).text, "今天下雨");
});

test("noteDisplay: 使用者自己寫的「無」「0」是內容，不是沒填", () => {
    assert.deepEqual(noteDisplay("無"), { text: "無", isEmpty: false });
    assert.deepEqual(noteDisplay("0"), { text: "0", isEmpty: false });
});

test("noteDisplay: 內容中間夾零寬字元仍是有內容，文字原樣不動", () => {
    const withZeroWidth = `冷凍櫃${String.fromCodePoint(0x200b)}溫度偏高`;
    assert.deepEqual(noteDisplay(withZeroWidth), { text: withZeroWidth, isEmpty: false });
});

test("noteDisplay: 超長備註與沒有斷點的長字串原樣回傳，不在這裡截斷（截斷是畫面的事）", () => {
    const longParagraphs = "收攤前清點發現 5 元硬幣少了 12 枚，已經用備用金補回。\n".repeat(40).trim();
    assert.equal(noteDisplay(longParagraphs).text, longParagraphs);
    assert.equal(noteDisplay(longParagraphs).isEmpty, false);
    const unbroken = "https://example.com/這是一個很長很長的網址/".repeat(10);
    assert.equal(noteDisplay(unbroken).text, unbroken);
});
