// 現金清點送出的稽核紀錄、營收備註與主帳覆寫稽核測試。
// 全部用記憶體假資料庫，不碰任何真實資料庫。
import { test } from "node:test";
import assert from "node:assert/strict";
import { persistCashCount, type CashTx, type PersistCashCountParams } from "./cash-submit";
import { buildCashSubmitAudit } from "./cash-audit";
import { upsertExpenseEntry, type EntryWriteDb } from "./fixedExpenseAutofill";

type Row = Record<string, unknown>;

function makeTx(seed?: { count?: Row; revenue?: Row }) {
    const logs: Row[] = [];
    const revenueWrites: Row[] = [];
    let count = seed?.count ?? null;
    const revenue = seed?.revenue ?? null;
    const tx = {
        cashCount: {
            findFirst: async () => count as never,
            update: async (a: { where: { id: string }; data: Row }) => {
                count = { ...count, ...a.data, id: a.where.id };
                return { id: a.where.id };
            },
            create: async () => ({ id: "cc-new" }),
        },
        revenue: {
            findFirst: async () => revenue as never,
            update: async (a: { where: { id: string }; data: Row }) => {
                revenueWrites.push(a.data);
                return { id: a.where.id };
            },
            create: async (a: { data: Row }) => {
                revenueWrites.push(a.data);
                return { id: "rev-new" };
            },
        },
        cashCountChecklistDone: { deleteMany: async () => ({}), create: async () => ({}) },
        operationLog: { create: async (a: { data: Row }) => void logs.push(a.data) },
    } as unknown as CashTx;
    return { tx, logs, revenueWrites };
}

const baseParams: PersistCashCountParams = {
    user: { id: "u-bob", username: "bob", tenantId: "t1" },
    locationId: "loc1",
    date: new Date(2026, 10, 20),
    dateStr: "2026-11-20",
    supervisorName: "老闆",
    cashBox: { map: { "500": 5 }, total: 2500 },
    reserve: { map: {}, total: 0 },
    sales: { map: { "1000": 3 }, total: 3000 },
    expenses: [{ item: "清潔費", note: "", amount: 500 }],
    expensesTotal: 500,
    totalSales: 3500,
    signatureDataUrl: "data:image/png;base64,SECRET_SIGNATURE_BYTES",
    note: "",
    checklistDone: [],
};

test("persistCashCount: 新增 -> 一筆 CREATE 稽核，無舊值，不含簽名與面額表", async () => {
    const { tx, logs } = makeTx();
    await persistCashCount(tx, baseParams);
    assert.equal(logs.length, 1);
    const log = logs[0];
    assert.equal(log.action, "CREATE");
    assert.equal(log.module, "CASH");
    assert.equal(log.target, "2026-11-20 loc1");
    assert.equal(log.userId, "u-bob");
    assert.equal(log.tenantId, "t1");
    const d = JSON.parse(log.details as string);
    assert.equal(d.overwrite, false);
    assert.deepEqual(d.revenueAmount, { before: null, after: 3500 });
    assert.deepEqual(d.totalSales, { before: null, after: 3500 });
    assert.equal(d.previousCashCountId, null);
    assert.equal(d.cashCountId, "cc-new");
    assert.ok(!(log.details as string).includes("SECRET_SIGNATURE"));
    assert.ok(!("cashBoxJson" in d) && !("signatureDataUrl" in d));
});

test("persistCashCount: 覆寫 -> UPDATE 稽核，帶舊值與新值、舊清點人與既有 CashCount id", async () => {
    const { tx, logs } = makeTx({
        count: { id: "cc-old", revenueId: "rev-old", attendantId: "u-alice", salesTotal: 1000, expensesTotal: 200, totalSales: 1200 },
        revenue: { id: "rev-old", amount: 1200, note: "原備註" },
    });
    await persistCashCount(tx, baseParams);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "UPDATE");
    const d = JSON.parse(logs[0].details as string);
    assert.equal(d.overwrite, true);
    assert.deepEqual(d.revenueAmount, { before: 1200, after: 3500 });
    assert.deepEqual(d.attendantId, { before: "u-alice", after: "u-bob" });
    assert.deepEqual(d.salesTotal, { before: 1000, after: 3000 });
    assert.deepEqual(d.expensesTotal, { before: 200, after: 500 });
    assert.deepEqual(d.totalSales, { before: 1200, after: 3500 });
    assert.equal(d.previousCashCountId, "cc-old");
});

test("persistCashCount: 只有 Revenue 已存在也算覆寫", async () => {
    const { tx, logs } = makeTx({ revenue: { id: "rev-old", amount: 999, note: null } });
    await persistCashCount(tx, baseParams);
    assert.equal(logs[0].action, "UPDATE");
    assert.deepEqual(JSON.parse(logs[0].details as string).revenueAmount, { before: 999, after: 3500 });
});

test("persistCashCount: 稽核寫入失敗會讓整個函式丟錯（交易回滾）", async () => {
    const { tx } = makeTx();
    (tx as unknown as { operationLog: { create: () => Promise<never> } }).operationLog.create = async () => {
        throw new Error("log failed");
    };
    await assert.rejects(() => persistCashCount(tx, baseParams), /log failed/);
});

test("persistCashCount: 營收備註同一人連續修正不重複附加", async () => {
    const marker = "cash 清點修正 (bob)";
    const { tx, revenueWrites } = makeTx({ revenue: { id: "rev-old", amount: 1, note: `原備註 | ${marker}` } });
    await persistCashCount(tx, baseParams);
    assert.equal(revenueWrites[0].note, `原備註 | ${marker}`);
});

test("persistCashCount: 營收備註超長被截到 500 字以內", async () => {
    const { tx, revenueWrites } = makeTx({ revenue: { id: "rev-old", amount: 1, note: "舊".repeat(3000) } });
    await persistCashCount(tx, baseParams);
    const note = revenueWrites[0].note as string;
    assert.ok(note.length <= 500);
    assert.ok(note.endsWith("cash 清點修正 (bob)"));
});

test("buildCashSubmitAudit: 沒有舊值時 before 都是 null", () => {
    const a = buildCashSubmitAudit({
        userId: "u", tenantId: "t", dateStr: "2026-01-01", locationId: "l", cashCountId: "c", revenueId: "r",
        revenue: { before: null, after: 10 }, previous: null,
        next: { attendantId: "u", salesTotal: 10, expensesTotal: 0, totalSales: 10 },
    });
    assert.equal(a.action, "CREATE");
    assert.equal(JSON.parse(a.details).attendantId.before, null);
});

// ---------- 主帳覆寫與新建的稽核 ----------

function makeEntryDb(existing?: { id: string; totalPrice: number; note: string }) {
    const logs: Row[] = [];
    const db: EntryWriteDb = {
        entry: {
            findFirst: async () => (existing ? { id: existing.id, totalPrice: existing.totalPrice } : null),
            findCandidates: async () => [],
            create: async () => ({ id: "entry-new" }),
            update: async (a) => ({ id: a.where.id }),
        },
        operationLog: { create: async (a) => void logs.push(a.data) },
    };
    return { db, logs };
}

const entryParams = {
    tenantId: "t1",
    date: new Date(2026, 10, 20),
    expenseType: "cleaning",
    note: "中山",
    amount: 700,
    userId: "u-bob",
    matchMode: "note" as const,
    auditSource: "CASH_COUNT",
};

test("upsertExpenseEntry: overwrite 真的改了金額 -> 一筆 UPDATE 稽核，舊值新值正確", async () => {
    const { db, logs } = makeEntryDb({ id: "e1", totalPrice: 500, note: "中山" });
    const r = await upsertExpenseEntry(db, { ...entryParams, mode: "overwrite" });
    assert.equal(r.action, "updated");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "UPDATE");
    assert.equal(logs[0].module, "ENTRY");
    assert.equal(logs[0].target, "e1");
    assert.equal(logs[0].userId, "u-bob");
    assert.equal(logs[0].tenantId, "t1");
    const d = JSON.parse(logs[0].details as string);
    assert.equal(d.source, "CASH_COUNT");
    assert.equal(d.date, "2026-11-20");
    assert.equal(d.expenseType, "cleaning");
    assert.deepEqual(d.amount, { before: 500, after: 700 });
});

test("upsertExpenseEntry: 金額沒變不重複記", async () => {
    const { db, logs } = makeEntryDb({ id: "e1", totalPrice: 700, note: "中山" });
    const r = await upsertExpenseEntry(db, { ...entryParams, mode: "overwrite" });
    assert.equal(r.action, "skipped");
    assert.equal(logs.length, 0);
});

test("upsertExpenseEntry: 新建（overwrite 與 skip-if-exists 兩種模式）都記 CREATE", async () => {
    for (const mode of ["overwrite", "skip-if-exists"] as const) {
        const { db, logs } = makeEntryDb();
        const r = await upsertExpenseEntry(db, { ...entryParams, mode, auditSource: "CASH_COUNT_AUTOFILL" });
        assert.equal(r.action, "created");
        assert.equal(logs.length, 1);
        assert.equal(logs[0].action, "CREATE");
        const d = JSON.parse(logs[0].details as string);
        assert.deepEqual(d.amount, { before: null, after: 700 });
        assert.equal(d.source, "CASH_COUNT_AUTOFILL");
        assert.equal(d.mode, mode);
    }
});

test("upsertExpenseEntry: skip-if-exists 遇到既有不改也不記", async () => {
    const { db, logs } = makeEntryDb({ id: "e1", totalPrice: 500, note: "中山" });
    const r = await upsertExpenseEntry(db, { ...entryParams, mode: "skip-if-exists" });
    assert.equal(r.action, "skipped");
    assert.equal(logs.length, 0);
});

test("upsertExpenseEntry: 沒給 auditSource 不記；稽核寫入失敗不影響主帳寫入結果", async () => {
    const a = makeEntryDb();
    await upsertExpenseEntry(a.db, { ...entryParams, mode: "overwrite", auditSource: undefined });
    assert.equal(a.logs.length, 0);

    const b = makeEntryDb({ id: "e1", totalPrice: 500, note: "中山" });
    b.db.operationLog = { create: async () => { throw new Error("audit down"); } };
    const r = await upsertExpenseEntry(b.db, { ...entryParams, mode: "overwrite" });
    assert.equal(r.action, "updated");
});
