// T-ML-027 範圍 C 的單元測試。
//
// resolveCashExpenseTarget 是純函式，直接測。syncCashExpensesToEntry 會呼叫
// classifyExpenseType()（讀真實 Dictionary，唯讀安全，比照 T-ML-025 批 1 慣例）
// 但寫入一律走注入的 FakeEntryWriteDb，不碰真實 docker-data/dev.db（同
// fixedExpenseAutofill.test.ts 的紅線）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCashExpenseTarget, syncCashExpensesToEntry, type CashExpenseRowInput } from "./cashExpenseSync";
import { upsertExpenseEntry, type EntryWriteDb } from "./fixedExpenseAutofill";
import { utcDate } from "./analytics/dateRange";
import { REAL_TENANT_ID } from "./analytics/testFixtures";

// ── resolveCashExpenseTarget（純函式） ──────────────────────────────────

test("resolveCashExpenseTarget: 有信心分類（清→清潔費）→ note 用乾淨的攤位標籤（跟 A 用同一把自然鍵）", () => {
    const row: CashExpenseRowInput = { item: "清", note: "", amount: 220 };
    const target = resolveCashExpenseTarget(row, { value: "清潔費", label: "清潔費", method: "fuzzy" }, "中山", "misc");
    assert.deepEqual(target, { expenseType: "清潔費", expenseLabel: "清潔費", note: "中山", confident: true });
});

test("resolveCashExpenseTarget: 分類不到（例如「大腸」）→ 落入雜支 fallback，note 保留原始文字方便複核", () => {
    const row: CashExpenseRowInput = { item: "大腸", note: "", amount: 250 };
    const target = resolveCashExpenseTarget(row, { value: null, label: null, method: "unknown" }, "中山", "misc");
    assert.deepEqual(target, { expenseType: "misc", expenseLabel: "雜支", note: "中山｜大腸", confident: false });
});

test("resolveCashExpenseTarget: fallback 的 note 會帶上使用者填的備註", () => {
    const row: CashExpenseRowInput = { item: "沙拉脫", note: "特價", amount: 660 };
    const target = resolveCashExpenseTarget(row, { value: null, label: null, method: "unknown" }, "中山", "misc");
    assert.equal(target?.note, "中山｜沙拉脫 特價");
});

test("resolveCashExpenseTarget: 租戶沒設雜支分類且分類不到 → null（呼叫端應記錄為 unclassified，不硬塞）", () => {
    const row: CashExpenseRowInput = { item: "大腸", note: "", amount: 250 };
    const target = resolveCashExpenseTarget(row, { value: null, label: null, method: "unknown" }, "中山", null);
    assert.equal(target, null);
});

// ── syncCashExpensesToEntry（整合：真實 Dictionary 唯讀分類 + 假資料庫寫入） ──

interface FakeRow {
    id: string; tenantId: string; type: string; date: Date; expenseType: string; note: string | null; totalPrice: number;
}

class FakeEntryWriteDb implements EntryWriteDb {
    rows: FakeRow[] = [];
    private seq = 0;
    entry = {
        findFirst: async (args: { where: { tenantId: string; type: string; date: Date; expenseType: string; note: string } }) => {
            const w = args.where;
            const row = this.rows.find((r) => r.tenantId === w.tenantId && r.type === w.type && r.date.getTime() === w.date.getTime() && r.expenseType === w.expenseType && r.note === w.note);
            return row ? { id: row.id, totalPrice: row.totalPrice } : null;
        },
        // T-ML-028：攤位模式用，不篩 note，交給呼叫端用 inferStallFromNote 逐筆判斷
        findCandidates: async (args: { where: { tenantId: string; type: string; date: Date; expenseType: string } }) => {
            const w = args.where;
            return this.rows
                .filter((r) => r.tenantId === w.tenantId && r.type === w.type && r.date.getTime() === w.date.getTime() && r.expenseType === w.expenseType)
                .map((r) => ({ id: r.id, totalPrice: r.totalPrice, note: r.note }));
        },
        create: async (args: { data: Record<string, unknown> }) => {
            const id = `fake-${++this.seq}`;
            this.rows.push({ id, tenantId: args.data.tenantId as string, type: args.data.type as string, date: args.data.date as Date, expenseType: args.data.expenseType as string, note: args.data.note as string | null, totalPrice: args.data.totalPrice as number });
            return { id };
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = this.rows.find((r) => r.id === args.where.id);
            if (row && typeof args.data.totalPrice === "number") row.totalPrice = args.data.totalPrice;
            return { id: args.where.id };
        },
    };
}

function pushRow(db: FakeEntryWriteDb, row: Omit<FakeRow, "id">): void {
    db.rows.push({ id: `seed-${db.rows.length + 1}`, ...row });
}

const DATE = utcDate(2026, 8, 9);

test("syncCashExpensesToEntry: 真實資料觀察到的清點列（清/洗/大腸/袋子）全部同步進 Entry", async () => {
    const db = new FakeEntryWriteDb();
    const rows: CashExpenseRowInput[] = [
        { item: "清", note: "", amount: 220 },
        { item: "洗", note: "", amount: 300 },
        { item: "大腸", note: "", amount: 250 },
        { item: "袋子", note: "", amount: 78 },
    ];
    const result = await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "pingtung", "attendant1", rows);
    assert.equal(result.synced.length, 4);
    assert.equal(result.unclassified.length, 0);
    assert.equal(db.rows.length, 4);

    const cleaning = result.synced.find((s) => s.item === "清")!;
    assert.equal(cleaning.expenseType, "清潔費");
    assert.equal(cleaning.confident, true);

    const wash = result.synced.find((s) => s.item === "洗")!;
    assert.equal(wash.expenseType, "EXP011");
    assert.equal(wash.confident, true);

    const intestine = result.synced.find((s) => s.item === "大腸")!;
    assert.equal(intestine.confident, false, "大腸不是支出類型，應該落入雜支 fallback");
    assert.equal(intestine.expenseLabel, "雜支");
});

test("syncCashExpensesToEntry: C 覆蓋 A — cash 清點的清潔費會覆寫掉 A 先前寫入的 formula 猜測值", async () => {
    const db = new FakeEntryWriteDb();
    // 模擬 A（自動帶固定支出）先寫入了公式猜的 220（跟 applyFixedExpenses 一樣走 stall 模式）
    await upsertExpenseEntry(db, { tenantId: REAL_TENANT_ID, date: DATE, expenseType: "清潔費", matchMode: "stall", stall: "pingtung", amount: 220, userId: null, mode: "skip-if-exists" });
    assert.equal(db.rows[0].totalPrice, 220);

    // cash 清點送出實付 110（那天可能不是公式預期的那個星期規則，或臨時打折）
    const result = await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "pingtung", "attendant1", [{ item: "清潔費", note: "", amount: 110 }]);
    assert.equal(result.synced[0].action, "updated");
    assert.equal(db.rows.length, 1, "應該是同一筆被更新，不是多一筆");
    assert.equal(db.rows[0].totalPrice, 110, "C 的實付數字應該覆蓋 A 的猜測值");
});

// ── T-ML-028 範圍 B：cash 同步層級的攤位 typo 正規化 ────────────────────────

test("T-ML-028 B: cash 清點覆寫既有 typo note（潮州攤）的清潔費紀錄，不多開一筆", async () => {
    const db = new FakeEntryWriteDb();
    // 模擬歷史資料：這筆清潔費當初手動輸入時攤位備註打成「潮州攤」（已知 typo 變體之一）
    pushRow(db, { tenantId: REAL_TENANT_ID, type: "EXPENSE", date: DATE, expenseType: "清潔費", note: "潮州攤", totalPrice: 220 });

    const result = await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "chaozhou", "attendant1", [{ item: "清", note: "", amount: 999 }]);
    assert.equal(result.synced[0].action, "updated");
    assert.equal(db.rows.length, 1, "應該找到潮州攤那筆並更新，不是誤判成不存在而多開一筆");
    assert.equal(db.rows[0].totalPrice, 999);
    assert.equal(db.rows[0].note, "潮州攤", "既有 note 文字不因為同步而被改寫成乾淨標籤");
});

test("T-ML-028 B: 雜支 fallback（大腸）不受攤位 typo 正規化影響，仍是 note 完全相等比對", async () => {
    const db = new FakeEntryWriteDb();
    // misc bucket 的 note 是「攤位｜品項文字」複合字串，不是單純攤位標籤，
    // 就算攤位標籤部分打成 typo 也不該被攤位推斷邏輯去比對這種自由文字備註
    pushRow(db, { tenantId: REAL_TENANT_ID, type: "EXPENSE", date: DATE, expenseType: "misc", note: "潮州攤｜大腸", totalPrice: 250 });

    const result = await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "chaozhou", "attendant1", [{ item: "大腸", note: "", amount: 260 }]);
    // note 會是 "潮州｜大腸"（乾淨標籤，非 typo 版本），跟既有的 "潮州攤｜大腸" 不完全相等
    // → 走 matchMode='note' 精確比對，判定為不同筆，另外建立一筆（雜支本來就不套用
    // 攤位模糊比對，維持既有「note 完全相等」語意）
    assert.equal(result.synced[0].action, "created");
    assert.equal(db.rows.length, 2);
});

test("syncCashExpensesToEntry: 同一天重複送出同樣的清點（更正重送）→ 更新同一筆，不重複建立", async () => {
    const db = new FakeEntryWriteDb();
    await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "pingtung", "attendant1", [{ item: "清", note: "", amount: 220 }]);
    await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "pingtung", "attendant1", [{ item: "清", note: "", amount: 190 }]); // 員工發現填錯，更正重送
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].totalPrice, 190);
});

test("syncCashExpensesToEntry: 金額 0 或空白項目名稱不同步", async () => {
    const db = new FakeEntryWriteDb();
    const result = await syncCashExpensesToEntry(db, REAL_TENANT_ID, DATE, "pingtung", "attendant1", [
        { item: "", note: "", amount: 100 },
        { item: "袋子", note: "", amount: 0 },
    ]);
    assert.equal(result.synced.length, 0);
    assert.equal(db.rows.length, 0);
});
