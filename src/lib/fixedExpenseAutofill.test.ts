// T-ML-027 範圍 A 的單元測試。
//
// 🔴 紅線：這支模組會寫入 Entry 表，絕對不能對真實 docker-data/dev.db 做
// create/update（T-ML-025 批 1 立下的規矩：吃真實 DB 的測試只能 SELECT）。
// 所以這裡全部用記憶體假資料庫（FakeEntryWriteDb）測 upsertExpenseEntry /
// applyFixedExpenses，purely-in-memory，不連任何真實資料庫。
// buildFixedExpensePreview 是純函式（不吃 DB），直接測。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildFixedExpensePreview,
    upsertExpenseEntry,
    applyFixedExpenses,
    type EntryWriteDb,
} from "./fixedExpenseAutofill";
import { utcDate } from "./analytics/dateRange";

const DICT = { cleaningValue: "清潔費", washValue: "EXP011" };

// ── buildFixedExpensePreview（純函式） ──────────────────────────────────

test("buildFixedExpensePreview: 屏東週一應該是清潔費220+洗攤300，且沒有既有紀錄", () => {
    const items = buildFixedExpensePreview("pingtung", 1, DICT, []);
    assert.deepEqual(
        items.map((i) => [i.expenseLabel, i.amount, i.alreadyExists]),
        [
            ["清潔費", 220, false],
            ["洗攤", 300, false],
        ]
    );
});

test("buildFixedExpensePreview: 潮州任何星期都是清潔費220+洗攤250", () => {
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
        const items = buildFixedExpensePreview("chaozhou", weekday, DICT, []);
        assert.equal(items[0].amount, 220);
        assert.equal(items[1].amount, 250);
    }
});

test("buildFixedExpensePreview: 已有 Entry（用 note 判斷攤位）→ alreadyExists=true 且回報既有金額", () => {
    const existing = [{ expenseType: "清潔費", note: "中山", totalPrice: 190 }];
    const items = buildFixedExpensePreview("pingtung", 2, DICT, existing);
    const cleaning = items.find((i) => i.expenseLabel === "清潔費")!;
    assert.equal(cleaning.alreadyExists, true);
    assert.equal(cleaning.existingAmount, 190);
    // 洗攤沒有對應紀錄，應該還是 alreadyExists=false
    const wash = items.find((i) => i.expenseLabel === "洗攤")!;
    assert.equal(wash.alreadyExists, false);
});

test("buildFixedExpensePreview: 潮州的既有 Entry 不會被誤判成屏東的（note 攤位判斷要精準）", () => {
    const existing = [{ expenseType: "清潔費", note: "潮州", totalPrice: 220 }];
    const items = buildFixedExpensePreview("pingtung", 1, DICT, existing);
    // 這筆是潮州的紀錄，不該讓屏東的清潔費被判定為 alreadyExists
    assert.equal(items[0].alreadyExists, false);
});

// ── FakeEntryWriteDb：記憶體假資料庫，供寫入路徑測試用 ───────────────────

interface FakeRow {
    id: string;
    tenantId: string;
    type: string;
    date: Date;
    expenseType: string;
    note: string;
    totalPrice: number;
}

class FakeEntryWriteDb implements EntryWriteDb {
    rows: FakeRow[] = [];
    private seq = 0;

    entry = {
        findFirst: async (args: { where: { tenantId: string; type: string; date: Date; expenseType: string; note: string } }) => {
            const w = args.where;
            const row = this.rows.find(
                (r) =>
                    r.tenantId === w.tenantId &&
                    r.type === w.type &&
                    r.date.getTime() === w.date.getTime() &&
                    r.expenseType === w.expenseType &&
                    r.note === w.note
            );
            return row ? { id: row.id, totalPrice: row.totalPrice } : null;
        },
        create: async (args: { data: Record<string, unknown> }) => {
            const id = `fake-${++this.seq}`;
            this.rows.push({
                id,
                tenantId: args.data.tenantId as string,
                type: args.data.type as string,
                date: args.data.date as Date,
                expenseType: args.data.expenseType as string,
                note: args.data.note as string,
                totalPrice: args.data.totalPrice as number,
            });
            return { id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = this.rows.find((r) => r.id === args.where.id);
            if (row && typeof args.data.totalPrice === "number") row.totalPrice = args.data.totalPrice;
            return { id: args.where.id };
        },
    };
}

const TENANT = "test-tenant";
const DATE = utcDate(2026, 8, 10); // Monday

// ── upsertExpenseEntry ───────────────────────────────────────────────────

test("upsertExpenseEntry: 不存在時建立新的一筆", async () => {
    const db = new FakeEntryWriteDb();
    const result = await upsertExpenseEntry(db, {
        tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 220, userId: "u1", mode: "skip-if-exists",
    });
    assert.equal(result.action, "created");
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].totalPrice, 220);
});

test("upsertExpenseEntry: skip-if-exists 模式 — 已存在就跳過，絕不覆寫（A 的冪等保證）", async () => {
    const db = new FakeEntryWriteDb();
    await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 220, userId: "u1", mode: "skip-if-exists" });
    const second = await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 999, userId: "u1", mode: "skip-if-exists" });
    assert.equal(second.action, "skipped");
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].totalPrice, 220, "skip-if-exists 不可覆寫既有金額");
});

test("upsertExpenseEntry: overwrite 模式 — 已存在且金額不同就更新（C 覆蓋 A 的實作核心）", async () => {
    const db = new FakeEntryWriteDb();
    await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 220, userId: null, mode: "skip-if-exists" }); // 模擬 A 先寫的formula guess
    const overwrite = await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 110, userId: "attendant1", mode: "overwrite" }); // C 帶著實付數字來
    assert.equal(overwrite.action, "updated");
    assert.equal(db.rows.length, 1, "不應該產生第二筆，是同一筆被更新");
    assert.equal(db.rows[0].totalPrice, 110, "C 的實付數字應該覆蓋 A 的 formula 猜測");
});

test("upsertExpenseEntry: overwrite 模式重複送出相同金額 — 冪等，不重複建立也不無謂 update", async () => {
    const db = new FakeEntryWriteDb();
    await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "EXP011", note: "中山", amount: 300, userId: "a1", mode: "overwrite" });
    const second = await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "EXP011", note: "中山", amount: 300, userId: "a1", mode: "overwrite" });
    assert.equal(second.action, "skipped");
    assert.equal(db.rows.length, 1);
});

test("upsertExpenseEntry: amount<=0 一律跳過，不建立任何紀錄", async () => {
    const db = new FakeEntryWriteDb();
    const result = await upsertExpenseEntry(db, { tenantId: TENANT, date: DATE, expenseType: "清潔費", note: "中山", amount: 0, userId: "u1", mode: "overwrite" });
    assert.equal(result.action, "skipped");
    assert.equal(db.rows.length, 0);
});

// ── applyFixedExpenses（A 的完整流程） ────────────────────────────────────

test("applyFixedExpenses: 兩筆都不存在 → 兩筆都建立", async () => {
    const db = new FakeEntryWriteDb();
    const result = await applyFixedExpenses(db, TENANT, DATE, "pingtung", "u1", [
        { expenseType: "清潔費", expenseLabel: "清潔費", amount: 220 },
        { expenseType: "EXP011", expenseLabel: "洗攤", amount: 300 },
    ]);
    assert.equal(result.created.length, 2);
    assert.equal(db.rows.length, 2);
    assert.ok(db.rows.every((r) => r.note === "中山"));
});

test("applyFixedExpenses: 同日重複呼叫（模擬使用者重複觸發）→ 不重複建立", async () => {
    const db = new FakeEntryWriteDb();
    const items = [{ expenseType: "清潔費", expenseLabel: "清潔費" as const, amount: 220 }];
    await applyFixedExpenses(db, TENANT, DATE, "pingtung", "u1", items);
    const second = await applyFixedExpenses(db, TENANT, DATE, "pingtung", "u1", items);
    assert.equal(second.skipped.length, 1);
    assert.equal(second.created.length, 0);
    assert.equal(db.rows.length, 1);
});

test("applyFixedExpenses: 使用者編輯過的金額會原樣寫入（不會被規則重新計算覆蓋）", async () => {
    const db = new FakeEntryWriteDb();
    // 使用者在網頁把清潔費從預覽建議的 220 手動改成 150 再送出
    await applyFixedExpenses(db, TENANT, DATE, "pingtung", "u1", [
        { expenseType: "清潔費", expenseLabel: "清潔費", amount: 150 },
    ]);
    assert.equal(db.rows[0].totalPrice, 150);
});

test("applyFixedExpenses: 屏東跟潮州同一天的 Entry 不會互相干擾（note 隔離）", async () => {
    const db = new FakeEntryWriteDb();
    await applyFixedExpenses(db, TENANT, DATE, "pingtung", "u1", [{ expenseType: "清潔費", expenseLabel: "清潔費", amount: 220 }]);
    const chaozhouResult = await applyFixedExpenses(db, TENANT, DATE, "chaozhou", "u1", [{ expenseType: "清潔費", expenseLabel: "清潔費", amount: 220 }]);
    assert.equal(chaozhouResult.created.length, 1, "潮州應該視為獨立的一筆，不因屏東已有清潔費就被跳過");
    assert.equal(db.rows.length, 2);
});
