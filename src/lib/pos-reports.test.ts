// Tests for POS reports on a small Chinese fixture (temp SQLite file, no real data). Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir = "";

before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-reports-"));
    process.env.YJC_DB_PATH = path.join(dir, "yjc.db");
    const { parseOps, applyOps } = await import("./yjc-db");
    const O = ["m_OrderNo", "m_WorkDate", "m_SaleTime", "m_CloseTime", "m_Total", "m_PayTotal", "m_Checkout"];
    const orders = [
        // 10/08：流水 0001、0002、0004（0003 是作廢單）；0004 明細只有 260（差 40）
        ["261008A0001", "2026/10/08", "2026-10-08 15:01:00.000", "2026-10-08 15:05:00.000", 100, 100, 1],
        ["261008A0002", "2026/10/08", "2026-10-08 16:10:00.000", "2026-10-08 16:12:00.000", 200, 200, 1],
        ["261008A0004", "2026/10/08", "2026-10-08 17:10:00.000", "2026-10-08 17:12:00.000", 300, 300, 1],
        // 10/09：兩張，尚未日結
        ["261009A0001", "2026/10/09", "2026-10-09 15:01:00.000", "2026-10-09 15:05:00.000", 150, 150, 1],
        ["261009A0002", "2026/10/09", "2026-10-09 16:01:00.000", "2026-10-09 16:05:00.000", 250, 250, 1],
        // 10/07：營業日 10/07，但 10/08 才結帳（日結後補結）
        ["261007A0001", "2026/10/07", "2026-10-07 15:01:00.000", "2026-10-07 15:05:00.000", 80, 80, 1],
        ["261007A0002", "2026/10/07", "2026-10-07 17:01:00.000", "2026-10-08 10:05:00.000", 20, 20, 1],
    ];
    applyOps(
        parseOps({
            ops: [
                { table: "i_orders", op: "insert", columns: O, rows: orders },
                {
                    table: "i_items",
                    op: "insert",
                    columns: ["p_OrderID", "p_serno", "p_FoodName", "p_Weight", "p_Total", "p_FoodID", "p_Count", "p_Price", "p_Return"],
                    rows: [
                        ["261008A0001", 1, "豬腳", 0.6, 100, "01001", 1, 100, 0],
                        ["261008A0002", 1, "米血", 0, 200, "02010", 1, 200, 0],
                        ["261008A0004", 1, "米血", 0, 260, "02011", 1, 260, 0],
                        ["261009A0001", 1, "豬腳", 1.2, 150, "01001", 1, 150, 0],
                        ["261009A0002", 1, "豬腳", 0.6, 250, "01001", 1, 250, 0],
                        ["261009A0001", 2, "豬腳 ", 0.3, 60, "01009", 1, 200, 0],
                        ["261009A0001", 3, "東坡肉(小)", 0.6, 120, "01004", 1, 120, 0],
                        ["261009A0002", 2, "豬腳", 0.6, -250, "01001", -1, 250, 1],
                        ["261007A0001", 1, "豬腳", 0, 80, "01001", 1, 80, 0],
                        ["261007A0002", 1, "豬腳", 0, 20, "01001", 1, 20, 0],
                    ],
                },
                {
                    table: "i_ordersDelete",
                    op: "insert",
                    columns: ["m_OrderNo", "m_WorkDate"],
                    rows: [["261008A0003", "2026/10/08"]],
                },
                {
                    table: "i_ShiftTotal",
                    op: "insert",
                    columns: ["z_id", "z_workdate", "z_shift", "z_name", "z_value"],
                    rows: [
                        [1, "2026/10/08", "@", "結帳數", "3"],
                        [2, "2026/10/08", "@", "銷售總額", "600"],
                        [3, "2026/10/07", "@", "結帳數", "1"],
                        [4, "2026/10/07", "@", "銷售總額", "80"],
                    ],
                },
                {
                    table: "i_shiftOpLog",
                    op: "insert",
                    columns: ["op_time", "op_Shifttype", "op_workdate"],
                    rows: [
                        ["2026-10-07 18:50:00.000", "Z", "2026/10/07"],
                        ["2026-10-08 18:50:00.000", "Z", "2026/10/08"],
                    ],
                },
            ],
        })
    );
});

after(async () => {
    const { getYjcDb } = await import("./yjc-db");
    getYjcDb().close();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("helpers: orderPrefix, weekdayOf, parseZNumber", async () => {
    const r = await import("./pos-reports");
    assert.equal(r.orderPrefix("2026/10/09"), "261009");
    assert.equal(r.weekdayOf("2026/10/09"), 5); // 週五
    assert.equal(r.parseZNumber("16,453"), 16453);
    assert.equal(r.parseZNumber(""), null);
});

test("checkSequence: gap 0003 is explained by the voided order", async () => {
    const r = await import("./pos-reports");
    const s = r.checkSequence("2026/10/08");
    assert.deepEqual(s.gaps, [3]);
    assert.deepEqual(s.explained, [3]);
    assert.equal(r.checkSequence("2026/10/09").gaps.length, 0);
});

test("getHealth: latest day has no Z yet -> pending, not a mismatch", async () => {
    const r = await import("./pos-reports");
    const h = r.getHealth()!;
    assert.equal(h.workDate, "2026/10/09");
    assert.equal(h.orders, 2);
    assert.equal(h.total, 400);
    const z = h.checks.find((c) => c.key === "z_recon")!;
    assert.equal(z.status, "pending");
    assert.match(z.value, /今日尚未日結/);
    assert.equal(h.checks.find((c) => c.key === "sequence")!.status, "pass");
});

test("getZRange: 10/07 mismatches because an order was closed after Z; 10/08 matches", async () => {
    const r = await import("./pos-reports");
    const rows = r.getZRange({ from: "2026-10-01", to: "2026-10-31" }, false);
    const d7 = rows.find((x) => x.date === "2026/10/07")!;
    const d8 = rows.find((x) => x.date === "2026/10/08")!;
    const d9 = rows.find((x) => x.date === "2026/10/09")!;
    assert.equal(d8.status, "match");
    assert.equal(d7.status, "mismatch");
    assert.match(d7.note, /日結後才結帳/);
    assert.equal(d9.status, "pending");
    const bad = r.getZRange({ from: "2026-10-01", to: "2026-10-31" }, true).map((x) => x.date);
    assert.deepEqual(bad, ["2026/10/07"]);
});

test("getZDay: lines compare against orders", async () => {
    const r = await import("./pos-reports");
    const day = r.getZDay("2026/10/08");
    const total = day.lines.find((l) => l.name === "銷售總額")!;
    assert.equal(total.match, true);
    assert.equal(day.orders.count, 3);
});

test("getHours groups by close hour", async () => {
    const r = await import("./pos-reports");
    const h = r.getHours({ from: "2026-10-09", to: "2026-10-09" });
    assert.deepEqual(
        h.rows.map((x) => [x.hour, x.orders, x.total]),
        [
            [15, 1, 150],
            [16, 1, 250],
        ]
    );
});

test("getMonthly: totals and weekday stats", async () => {
    const r = await import("./pos-reports");
    const m = r.getMonthly("2026/10")!;
    assert.equal(m.openDays, 3);
    assert.equal(m.orders, 7);
    assert.equal(m.total, 1100);
    assert.equal(m.monthStats[5].days, 1); // 10/09 週五
});

test("day detail: comparisons, anomalies, order mismatch", async () => {
    const d = await import("./pos-day");
    const cmp = d.getComparisons("2026/10/09");
    assert.equal(cmp[0].note, "2026/10/08");
    assert.equal(cmp[0].base!.total, 600);
    assert.equal(cmp[1].base, null); // 上週同一天沒營業
    const an = d.getDayAnomalies("2026/10/08");
    assert.ok(an.some((a) => a.kind === "gap" && a.detail.includes("POS 作廢單")));
    assert.ok(an.some((a) => a.kind === "deleted"));
    const an7 = d.getDayAnomalies("2026/10/07");
    assert.ok(an7.some((a) => a.kind === "cross_later"));
    const orders = d.getDayOrders("2026/10/08");
    assert.equal(orders.filter((o) => o.mismatch).length, 1);
    assert.equal(orders.find((o) => o.mismatch)!.diff, 40);
    assert.deepEqual(d.diffPct(110, 100), { diff: 10, pct: 10 });
    const items = d.getDayItems("2026/10/08", "total");
    assert.equal(items.rows.find((x) => x.name === "米血")!.total, 460); // 兩個編號合併
});

test("order detail flags the 40 difference", async () => {
    const q = await import("./pos-queries");
    const d = q.getOrderDetail("261008A0004")!;
    assert.equal(d.mismatch, true);
    assert.equal(d.diff, 40);
    assert.equal(q.getOrderDetail("261008A0001")!.mismatch, false);
    const only = q.searchOrders({ from: null, to: null }, "", 1, true);
    const nos = only.rows.map((r) => r.m_OrderNo);
    assert.ok(nos.includes("261008A0004"));
    assert.ok(!nos.includes("261008A0001"));
});

test("getItemLines: merges ids and trailing-space names, summary equals the ranking row, flags returns", async () => {
    const q = await import("./pos-queries");
    const range = { from: "2026-10-09", to: "2026-10-09" };
    const rank = q.getItemRanking(range, "total").rows.find((r) => r.name === "豬腳")!;
    const d = q.getItemLines(range, "豬腳", 1);
    assert.equal(d.summary.n, rank.n);
    assert.equal(d.summary.total, rank.total);
    assert.equal(d.summary.kg, rank.kg);
    assert.equal(d.lines.length, rank.n);
    assert.ok(d.lines.some((l) => l.p_Return === 1));
    assert.ok(d.lines.some((l) => l.p_FoodID === "01009")); // 尾端空白那筆（不同編號）也在
    // 括號與空白的名稱
    assert.equal(q.getItemLines(range, "  東坡肉(小) ", 1).summary.n, 1);
    assert.equal(q.getItemLines(range, "沒有這個品項", 1).summary.n, 0);
    // 分頁：第 2 頁沒資料但 summary 仍是全部
    const p2 = q.getItemLines(range, "豬腳", 2);
    assert.equal(p2.lines.length, 0);
    assert.equal(p2.summary.n, rank.n);
});
