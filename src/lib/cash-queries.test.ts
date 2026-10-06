// T-ML-034 Phase C：cash 查詢條件（歷史列表、分析頁、今日已提交提示）。
// 重點：(1) 既有條件 from / to / mineOnly 的行為完全不變；(2) 新增的 locationId 是可選參數；
// (3) 今日已提交的查詢日期與 submitCashCount 同一套 parseLocalDate。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildCashCountWhere,
    buildStatsWhere,
    submissionLookupWhere,
    submissionNoticeText,
    toSubmissionNotice,
} from "./cash-queries";
import { parseLocalDate } from "./date";

const ADMIN = { id: "user_洪怜俼", tenantId: "tenant_洪記軒", isAdmin: true };
const STAFF = { id: "user_清點員一號", tenantId: "tenant_洪記軒", isAdmin: false };

// ── 既有行為（改動前就存在，不能變）──────────────────────────

test("buildCashCountWhere: 管理者不帶任何條件 → 只有租戶（看全部）", () => {
    assert.deepEqual(buildCashCountWhere(ADMIN), { tenantId: "tenant_洪記軒" });
    assert.deepEqual(buildCashCountWhere(ADMIN, {}), { tenantId: "tenant_洪記軒" });
});

test("buildCashCountWhere: 員工一律只看自己的紀錄", () => {
    assert.deepEqual(buildCashCountWhere(STAFF), { tenantId: "tenant_洪記軒", attendantId: "user_清點員一號" });
});

test("buildCashCountWhere: 管理者 mineOnly=true 也只看自己", () => {
    assert.deepEqual(buildCashCountWhere(ADMIN, { mineOnly: true }), {
        tenantId: "tenant_洪記軒",
        attendantId: "user_洪怜俼",
    });
});

test("buildCashCountWhere: from / to 用 parseLocalDate 解析，gte / lte 同時存在", () => {
    const where = buildCashCountWhere(ADMIN, { from: "2026-10-01", to: "2026-10-06" }) as {
        date: { gte: Date; lte: Date };
    };
    assert.equal(where.date.gte.getTime(), parseLocalDate("2026-10-01")!.getTime());
    assert.equal(where.date.lte.getTime(), parseLocalDate("2026-10-06")!.getTime());
});

test("buildCashCountWhere: 只帶 from 或只帶 to 時只有單邊", () => {
    const onlyFrom = buildCashCountWhere(ADMIN, { from: "2026-10-01" }) as { date: Record<string, Date> };
    assert.deepEqual(Object.keys(onlyFrom.date), ["gte"]);
    const onlyTo = buildCashCountWhere(ADMIN, { to: "2026-10-06" }) as { date: Record<string, Date> };
    assert.deepEqual(Object.keys(onlyTo.date), ["lte"]);
});

test("buildCashCountWhere: 不合法的日期字串被忽略（跟以前一樣不炸）", () => {
    assert.deepEqual(buildCashCountWhere(ADMIN, { from: "壞掉的日期", to: "" }), { tenantId: "tenant_洪記軒" });
});

// ── 新增：攤位篩選（可選參數）────────────────────────────────

test("buildCashCountWhere: 帶 locationId 才加攤位條件；沒帶就跟以前完全一樣", () => {
    assert.equal("locationId" in buildCashCountWhere(ADMIN, { from: "2026-10-01" }), false);
    assert.equal("locationId" in buildCashCountWhere(ADMIN, { locationId: "" }), false);
    assert.deepEqual(buildCashCountWhere(ADMIN, { locationId: "loc_潮州攤位" }), {
        tenantId: "tenant_洪記軒",
        locationId: "loc_潮州攤位",
    });
});

test("buildCashCountWhere: 攤位篩選可以和日期、員工限制並存", () => {
    const where = buildCashCountWhere(STAFF, { from: "2026-10-01", locationId: "loc_屏東攤位" });
    assert.equal(where.tenantId, "tenant_洪記軒");
    assert.equal(where.attendantId, "user_清點員一號");
    assert.equal(where.locationId, "loc_屏東攤位");
    assert.ok((where.date as { gte: Date }).gte instanceof Date);
});

test("buildStatsWhere: 近 N 天 + 可選攤位", () => {
    const since = new Date("2026-07-08T00:00:00.000Z");
    assert.deepEqual(buildStatsWhere({ tenantId: "tenant_洪記軒", since }), {
        tenantId: "tenant_洪記軒",
        date: { gte: since },
    });
    assert.deepEqual(buildStatsWhere({ tenantId: "tenant_洪記軒", since, locationId: "loc_潮州攤位" }), {
        tenantId: "tenant_洪記軒",
        date: { gte: since },
        locationId: "loc_潮州攤位",
    });
});

// ── 今日已提交提示 ───────────────────────────────────────────

test("submissionLookupWhere: 日期與 submitCashCount 同一套 parseLocalDate（不會差一天）", () => {
    const where = submissionLookupWhere({ tenantId: "tenant_洪記軒", locationId: "loc_潮州攤位", today: "2026-10-06" });
    assert.ok(where);
    assert.equal(where.date.getTime(), parseLocalDate("2026-10-06")!.getTime());
    assert.equal(where.locationId, "loc_潮州攤位");
    assert.equal(where.tenantId, "tenant_洪記軒");
});

test("submissionLookupWhere: today 不合法回 null（頁面就不顯示提示，不會炸）", () => {
    assert.equal(submissionLookupWhere({ tenantId: "t", locationId: "l", today: "" }), null);
    assert.equal(submissionLookupWhere({ tenantId: "t", locationId: "l", today: "今天" }), null);
});

test("toSubmissionNotice: 時間是台北時間 HH:mm，姓名優先用 realName 否則 username", () => {
    const withName = toSubmissionNotice({
        id: "cc_1",
        handoverTime: new Date("2026-10-06T14:41:00.000Z"),
        attendant: { realName: "洪怜俼", username: "mom" },
    });
    assert.deepEqual(withName, { id: "cc_1", timeLabel: "22:41", byName: "洪怜俼" });

    const withoutName = toSubmissionNotice({
        id: "cc_2",
        handoverTime: new Date("2026-10-06T00:05:00.000Z"),
        attendant: { realName: null, username: "2" },
    });
    assert.deepEqual(withoutName, { id: "cc_2", timeLabel: "08:05", byName: "2" });
});

test("submissionNoticeText: 說清楚時間、誰提交的、再次提交會覆蓋", () => {
    const text = submissionNoticeText({ id: "cc_1", timeLabel: "22:41", byName: "清點員" });
    assert.equal(text, "今天這個攤位已在 22:41 由 清點員 提交過一次。再次提交會覆蓋原本內容。");
});
