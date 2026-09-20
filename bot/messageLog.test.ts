// T-ML-033 的單元測試。
//
// 🔴 紅線：這支模組會寫入 BotMessageLog 表，絕對不能對真實 docker-data/dev.db 做
// create/update（T-ML-025 批 1 立下的規矩：吃真實 DB 的測試只能 SELECT，見
// src/lib/fixedExpenseAutofill.test.ts 的先例）。全部用記憶體假資料庫
// （FakeBotMessageLogDb）測 logIncoming / logOutcome / logCallback，purely-in-memory，
// 不連任何真實資料庫。
//
// fixture 一律用中文（記帳系統的真實輸入本來就是中文，用 ASCII 假資料會漏掉「中文
// 進到某個沒處理好的地方」這類問題——vault 已有前例：ASCII fixture 曾經讓中文檔名
// 撞進 HTTP header 直接 500，中文卻沒事，教訓是測試資料要跟生產輸入同型）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    logIncoming,
    logOutcome,
    logCallback,
    type BotMessageLogDb,
    type BotMessageLogCreateData,
} from "./messageLog";

// ── FakeBotMessageLogDb：記憶體假資料庫，供寫入路徑測試用 ────────────────

interface FakeRow extends BotMessageLogCreateData {
    id: number;
}

function makeFakeDb(): { db: BotMessageLogDb; rows: FakeRow[] } {
    const rows: FakeRow[] = [];
    let nextId = 1;
    const db: BotMessageLogDb = {
        create: async (args) => {
            const row: FakeRow = { id: nextId++, ...args.data };
            rows.push(row);
            return { id: row.id };
        },
        update: async (args) => {
            const row = rows.find((r) => r.id === args.where.id);
            if (!row) throw new Error(`FakeBotMessageLogDb: row ${args.where.id} not found`);
            Object.assign(row, args.data);
            return row;
        },
    };
    return { db, rows };
}

/** 永遠 reject 的假 db，模擬「DB 寫入失敗」（例如容器重啟中、磁碟滿）。 */
function makeRejectingDb(): BotMessageLogDb {
    return {
        create: async () => {
            throw new Error("boom: create rejected");
        },
        update: async () => {
            throw new Error("boom: update rejected");
        },
    };
}

// ── logIncoming：中文 fixture 涵蓋 entry / dayoff / query / callback 幾種 route ──

test("logIncoming: 進貨（肝連2.6台斤218廠商海豐）→ route=entry，parsedJson 保留中文與數字欄位", async () => {
    const { db, rows } = makeFakeDb();
    const logId = await logIncoming({
        chatId: 123456,
        messageId: 1001,
        telegramUserId: 987654,
        tenantId: "tenant-a",
        text: "肝連2.6台斤218廠商海豐",
        route: "entry",
        llmProvider: "claude",
        parsed: [{ type: "PURCHASE", itemName: "肝連", quantity: 2.6, unit: "台斤", price: 218, vendor: "海豐", note: null, date: "2026-09-20" }],
    }, db);

    assert.equal(logId, 1);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.chatId, "123456");
    assert.equal(row.messageId, 1001);
    assert.equal(row.telegramUserId, "987654");
    assert.equal(row.route, "entry");
    assert.equal(row.llmProvider, "claude");
    assert.equal(row.text, "肝連2.6台斤218廠商海豐");
    assert.deepEqual(JSON.parse(row.parsedJson!), [
        { type: "PURCHASE", itemName: "肝連", quantity: 2.6, unit: "台斤", price: 218, vendor: "海豐", note: null, date: "2026-09-20" },
    ]);
});

test("logIncoming: 營業額（7/15 屏東 12300）→ route=entry，REVENUE 形狀", async () => {
    const { db, rows } = makeFakeDb();
    await logIncoming({
        chatId: 123456,
        text: "7/15 屏東 12300",
        route: "entry",
        llmProvider: "claude",
        parsed: [{ type: "REVENUE", itemName: "屏東", quantity: null, unit: null, price: 12300, vendor: null, note: null, date: "2026-07-15" }],
    }, db);

    assert.equal(rows.length, 1);
    const parsed = JSON.parse(rows[0].parsedJson!);
    assert.equal(parsed[0].type, "REVENUE");
    assert.equal(parsed[0].itemName, "屏東");
    assert.equal(parsed[0].price, 12300);
});

test("logIncoming: 支出（洗攤250備註潮州）→ route=entry，EXPENSE 形狀", async () => {
    const { db, rows } = makeFakeDb();
    await logIncoming({
        chatId: 123456,
        text: "洗攤250備註潮州",
        route: "entry",
        llmProvider: "claude",
        parsed: [{ type: "EXPENSE", itemName: "洗攤", quantity: null, unit: null, price: 250, vendor: null, note: "潮州", date: "2026-09-20" }],
    }, db);

    const parsed = JSON.parse(rows[0].parsedJson!);
    assert.equal(parsed[0].type, "EXPENSE");
    assert.equal(parsed[0].note, "潮州");
});

test("logIncoming: 休假（潮州公休）→ route=dayoff，llmProvider 為 null（pre-LLM 快速路徑沒呼叫 LLM）", async () => {
    const { db, rows } = makeFakeDb();
    await logIncoming({
        chatId: 123456,
        text: "潮州公休",
        route: "dayoff",
        llmProvider: null,
        parsed: [{ type: "REVENUE", itemName: "潮州", quantity: null, unit: null, price: 0, vendor: null, note: null, date: "2026-09-20" }],
        outcome: "auto_saved",
    }, db);

    assert.equal(rows[0].route, "dayoff");
    assert.equal(rows[0].llmProvider, null);
    assert.equal(rows[0].outcome, "auto_saved");
});

test("logIncoming: 查詢（4月 永新）→ route=query，outcome=query_ok，finalJson 記結果預覽", async () => {
    const { db, rows } = makeFakeDb();
    await logIncoming({
        chatId: 123456,
        text: "4月 永新",
        route: "query",
        parsed: { detector: "vendorMonth", vendorName: "永新", month: 4 },
        outcome: "query_ok",
        final: { resultPreview: "永新 4月 共進貨 12 筆，合計 $45,600" },
    }, db);

    assert.equal(rows[0].route, "query");
    assert.equal(rows[0].outcome, "query_ok");
    assert.equal(JSON.parse(rows[0].finalJson!).resultPreview, "永新 4月 共進貨 12 筆，合計 $45,600");
});

test("logIncoming: parsed/final 為 undefined 時 parsedJson/finalJson 存 null（不是字串 'undefined'）", async () => {
    const { db, rows } = makeFakeDb();
    await logIncoming({ chatId: 1, text: "/help", route: "command" }, db);
    assert.equal(rows[0].parsedJson, null);
    assert.equal(rows[0].finalJson, null);
    assert.equal(rows[0].outcome, null);
});

// ── logOutcome：回填既有列 ────────────────────────────────────────────────

test("logOutcome: 用 logIncoming 回傳的 id 回填 outcome + finalJson", async () => {
    const { db, rows } = makeFakeDb();
    const logId = await logIncoming({
        chatId: 123456, text: "肝連2.6台斤218廠商海豐", route: "entry",
    }, db);

    await logOutcome(logId, "confirmed", {
        saved: [{ type: "PURCHASE", itemId: "item-1", itemName: "肝連", expenseType: null, locationName: null, price: 218, quantity: 2.6, unit: "台斤", entryId: "entry-1" }],
        failed: [],
    }, db);

    assert.equal(rows[0].outcome, "confirmed");
    const final = JSON.parse(rows[0].finalJson!);
    assert.equal(final.saved[0].itemName, "肝連");
    assert.equal(final.saved[0].entryId, "entry-1");
});

test("logOutcome: logId 是 null/undefined 時安靜跳過，不呼叫 db.update", async (t) => {
    const { db } = makeFakeDb();
    const updateSpy = t.mock.method(db, "update");

    await logOutcome(null, "rejected", undefined, db);
    await logOutcome(undefined, "rejected", undefined, db);

    assert.equal(updateSpy.mock.callCount(), 0);
});

test("logOutcome: 更新不存在的 logId（例如列已被清掉）失敗時只 warn 不拋錯", async (t) => {
    const { db } = makeFakeDb(); // 空的，沒有任何列
    const warnSpy = t.mock.method(console, "warn", () => {});

    await assert.doesNotReject(logOutcome(999, "confirmed", undefined, db));
    assert.equal(warnSpy.mock.callCount(), 1);
    assert.match(String(warnSpy.mock.calls[0].arguments[0]), /logOutcome failed/);
});

// ── logCallback：找不到 pendingLogId 時的 fallback ──────────────────────────

test("logCallback: route 固定為 callback，text 存 callback_data，refMessageId 可回溯原訊息", async () => {
    const { db, rows } = makeFakeDb();
    const logId = await logCallback({
        chatId: 123456,
        telegramUserId: 987654,
        tenantId: "tenant-a",
        text: "confirm_yes_0",
        refMessageId: 2002,
    }, db);

    assert.equal(logId, 1);
    assert.equal(rows[0].route, "callback");
    assert.equal(rows[0].text, "confirm_yes_0");
    assert.equal(rows[0].refMessageId, 2002);
});

// ── 寫入失敗：bot 主流程絕不能因為記 log 而被拖垮 ───────────────────────────

test("logIncoming: db.create reject 時只 console.warn，回傳 null，不拋錯", async (t) => {
    const failingDb = makeRejectingDb();
    const warnSpy = t.mock.method(console, "warn", () => {});

    // 直接 await：logIncoming 內部已經 try/catch，這裡若還會 reject 代表實作有漏洞，
    // 測試本身應該直接失敗（不需要额外包 assert.doesNotReject，那個 helper 只回傳
    // undefined，接不到 resolve 值）。
    const result = await logIncoming(
        { chatId: 123456, text: "肝連2.6台斤218廠商海豐", route: "entry" }, failingDb,
    );

    assert.equal(result, null);
    assert.equal(warnSpy.mock.callCount(), 1);
    assert.match(String(warnSpy.mock.calls[0].arguments[0]), /logIncoming failed/);
});

test("logOutcome: db.update reject 時只 console.warn，不拋錯", async (t) => {
    const failingDb = makeRejectingDb();
    const warnSpy = t.mock.method(console, "warn", () => {});

    await assert.doesNotReject(logOutcome(1, "confirmed", undefined, failingDb));

    assert.equal(warnSpy.mock.callCount(), 1);
    assert.match(String(warnSpy.mock.calls[0].arguments[0]), /logOutcome failed/);
});

test("logCallback: db.create reject 時只 console.warn，回傳 null，不拋錯", async (t) => {
    const failingDb = makeRejectingDb();
    const warnSpy = t.mock.method(console, "warn", () => {});

    const result = await logCallback({ chatId: 123456, text: "confirm_no_0" }, failingDb);

    assert.equal(result, null);
    assert.equal(warnSpy.mock.callCount(), 1);
    assert.match(String(warnSpy.mock.calls[0].arguments[0]), /logCallback failed/);
});
