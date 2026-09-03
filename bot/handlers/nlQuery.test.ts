// Unit tests for bot/handlers/nlQuery pure helpers（不打 LLM）.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { isQueryLike, parseNlResponse, validateAndResolve } from "./nlQuery";
import type { DbContext } from "../types";

const CTX: DbContext = {
    tenantId: "t",
    categories: [],
    items: [
        { id: "i1", name: "頭皮", categoryId: "c", defaultUnit: "kg", categoryName: "肉類" },
        { id: "i2", name: "舌頭", categoryId: "c", defaultUnit: "kg", categoryName: "肉類" },
    ],
    vendors: [{ id: "v1", name: "海豐" }, { id: "v2", name: "俊偉" }, { id: "v3", name: "建國滷蛋" }],
    expenseTypes: [
        { id: "e1", value: "薪資", label: "薪資" },
        { id: "e2", value: "rent", label: "租金" },
        { id: "e3", value: "EXP001", label: "租金" },
        { id: "e4", value: "清潔費", label: "清潔費" },
    ],
    units: [],
    locations: [{ id: "l1", name: "屏東攤位" }, { id: "l2", name: "潮州攤位" }],
};

// ── 閘門：記帳絕不能進 LLM ────────────────────────────────────────
test("isQueryLike: 記帳輸入一律 false（有金額/數量）", () => {
    for (const t of ["頭皮2個240", "8/13 頭皮2個240", "潮州5000", "薪資1300備註阿秀", "8月4號大骨粉，40公斤，8200", "肝連2.6台斤218"]) {
        assert.equal(isQueryLike(t), false, `「${t}」是記帳，不該進 NL`);
    }
});

test("isQueryLike: 問句 true（含月份、TOP N、問號）", () => {
    for (const t of ["8月每個人的薪水各多少", "8月哪天賺最多", "屏東8月平均一天多少", "上半年每月營業額",
                     "7月跟8月屏東營業額差多少", "海豐上個月每次進貨明細", "本月TOP5廠商", "前3名品項", "8月清潔費每天多少", "昨天賣得怎樣？"]) {
        assert.equal(isQueryLike(t), true, `「${t}」是問句`);
    }
});

test("isQueryLike: 指令與空字串 false", () => {
    assert.equal(isQueryLike("/menu"), false);
    assert.equal(isQueryLike("   "), false);
});

// ── 解析 LLM 回覆 ─────────────────────────────────────────────────
test("parseNlResponse: 純 JSON / code fence / 前後贅字 都能抓到", () => {
    const j = '{"metric":"revenue","period":{"from":"2026-08-01","to":"2026-09-01"}}';
    assert.equal(parseNlResponse(j)?.metric, "revenue");
    assert.equal(parseNlResponse("```json\n" + j + "\n```")?.metric, "revenue");
    assert.equal(parseNlResponse("好的，這是結果：" + j + " 希望有幫助")?.metric, "revenue");
});

test("parseNlResponse: 不合 schema → null（不會把亂七八糟的東西當 spec）", () => {
    assert.equal(parseNlResponse('{"metric":"sales"}'), null);
    assert.equal(parseNlResponse('{"metric":"revenue","topN":999}'), null);
    assert.equal(parseNlResponse("我不知道你在問什麼"), null);
});

test("parseNlResponse: clarify 形式可過", () => {
    const d = parseNlResponse('{"clarify":"你要查哪個攤位？"}');
    assert.equal(d?.clarify, "你要查哪個攤位？");
});

// ── 驗證 + 實體解析 ──────────────────────────────────────────────
test("validateAndResolve: 薪資依人 → spec 正確，同義詞薪水→薪資", () => {
    const out = validateAndResolve({
        metric: "expense", period: { from: "2026-08-01", to: "2026-09-01", label: "2026年8月" },
        groupBy: "note", filters: { expenseType: "薪水" },
    }, CTX);
    assert.equal(out.kind, "spec");
    if (out.kind !== "spec") return;
    assert.equal(out.spec.metric, "expense");
    assert.equal(out.spec.groupBy, "note");
    assert.deepEqual(out.spec.filters?.expenseTypeValues, ["薪資"]);
    assert.match(out.restate, /薪資/);
});

test("validateAndResolve: 重複 label 的支出類型帶回全部 value（租金＝rent/EXP001）", () => {
    const out = validateAndResolve({
        metric: "expense", period: { from: "2026-08-01", to: "2026-09-01" }, filters: { expenseType: "房租" },
    }, CTX);
    assert.equal(out.kind, "spec");
    if (out.kind !== "spec") return;
    assert.deepEqual([...out.spec.filters!.expenseTypeValues!].sort(), ["EXP001", "rent"]);
});

test("validateAndResolve: 攤位簡稱「屏東」對到「屏東攤位」", () => {
    const out = validateAndResolve({
        metric: "revenue", period: { from: "2026-08-01", to: "2026-09-01" }, groupBy: "day", filters: { location: "屏東" },
    }, CTX);
    assert.equal(out.kind, "spec");
    if (out.kind !== "spec") return;
    assert.equal(out.spec.filters?.locationId, "l1");
});

test("validateAndResolve: 找不到的廠商 → clarify 並附候選，不猜", () => {
    const out = validateAndResolve({
        metric: "purchase", period: { from: "2026-08-01", to: "2026-09-01" }, agg: "list", filters: { vendor: "阿明" },
    }, CTX);
    assert.equal(out.kind, "clarify");
    if (out.kind !== "clarify") return;
    assert.match(out.question, /找不到廠商「阿明」/);
    assert.match(out.question, /海豐|俊偉|建國滷蛋/);
});

test("validateAndResolve: 期間不合理 → clarify（結束早於開始／太長）", () => {
    const bad1 = validateAndResolve({ metric: "revenue", period: { from: "2026-09-01", to: "2026-08-01" } }, CTX);
    assert.equal(bad1.kind, "clarify");
    const bad2 = validateAndResolve({ metric: "revenue", period: { from: "2024-01-01", to: "2026-09-01" } }, CTX);
    assert.equal(bad2.kind, "clarify");
    if (bad2.kind === "clarify") assert.match(bad2.question, /太長/);
});

test("validateAndResolve: 沒給期間 → 預設本月，不追問", () => {
    const out = validateAndResolve({ metric: "revenue" }, CTX);
    assert.equal(out.kind, "spec");
    if (out.kind !== "spec") return;
    assert.equal(out.spec.period.from.getDate(), 1);
});

test("validateAndResolve: 篩選與指標不一致 → 糾正而不是靜默丟掉篩選", () => {
    const out = validateAndResolve({
        metric: "revenue", period: { from: "2026-08-01", to: "2026-09-01" }, filters: { vendor: "海豐" },
    }, CTX);
    assert.equal(out.kind, "clarify");
    if (out.kind === "clarify") assert.match(out.question, /進貨/);
});

test("validateAndResolve: compareTo 進 spec，restate 有 vs", () => {
    const out = validateAndResolve({
        metric: "revenue",
        period: { from: "2026-08-01", to: "2026-09-01", label: "8月" },
        compareTo: { from: "2026-07-01", to: "2026-08-01", label: "7月" },
    }, CTX);
    assert.equal(out.kind, "spec");
    if (out.kind !== "spec") return;
    assert.ok(out.spec.compareTo);
    assert.match(out.restate, /vs 7月/);
});
