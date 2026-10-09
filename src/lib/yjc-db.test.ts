// Unit tests for the POS mirror import (yjc.db). Run: npm test
// 用暫存目錄裡的獨立 SQLite 檔，不碰任何真實資料。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir = "";

before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yjc-test-"));
    process.env.YJC_DB_PATH = path.join(dir, "yjc.db");
});

after(async () => {
    const { getYjcDb } = await import("./yjc-db");
    getYjcDb().close();
    fs.rmSync(dir, { recursive: true, force: true });
});

test("parseOps: rejects non-whitelisted tables and bad column names", async () => {
    const { parseOps } = await import("./yjc-db");
    assert.throws(() => parseOps({ ops: [{ table: "User", op: "clear" }] }), /白名單/);
    assert.throws(
        () => parseOps({ ops: [{ table: "i_orders", op: "insert", columns: ["a b"], rows: [["x"]] }] }),
        /欄位名/
    );
    assert.throws(
        () => parseOps({ ops: [{ table: "i_orders", op: "insert", columns: ["a"], rows: [["x", "y"]] }] }),
        /欄位數/
    );
    assert.throws(() => parseOps({ ops: [{ table: "i_orders", op: "drop" }] }), /未知/);
    assert.throws(() => parseOps({}), /ops/);
});

test("applyOps: creates table, indexes, inserts Chinese rows, adds new columns", async () => {
    const { parseOps, applyOps, getYjcDb, getLastImportAt } = await import("./yjc-db");
    const r = applyOps(
        parseOps({
            ops: [
                { table: "i_orders", op: "clear" },
                {
                    table: "i_orders",
                    op: "insert",
                    columns: ["m_OrderNo", "m_WorkDate", "m_Total", "m_Checkout"],
                    rows: [
                        ["261009A0040", "2026/10/09", 227, 1],
                        ["261009A0041", "2026/10/09", 150, 1],
                    ],
                },
                {
                    table: "i_items",
                    op: "insert",
                    columns: ["p_OrderID", "p_serno", "p_FoodName", "p_Weight", "p_Total"],
                    rows: [["261009A0040", 1, "豬耳朵", 0.124, 144]],
                },
            ],
        })
    );
    assert.deepEqual(r, { ops: 3, rows: 3 });
    const db = getYjcDb();
    const name = db.prepare(`SELECT p_FoodName AS n FROM i_items`).get() as { n: string };
    assert.equal(name.n, "豬耳朵");
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as Array<{ name: string }>;
    assert.ok(idx.some((i) => i.name === "ix_i_orders_m_OrderNo"));
    assert.ok(idx.some((i) => i.name === "ix_i_items_p_OrderID"));
    assert.ok(getLastImportAt());

    // 廠商改版加欄位：自動 ALTER TABLE
    applyOps(
        parseOps({
            ops: [{ table: "i_orders", op: "insert", columns: ["m_OrderNo", "m_NewCol"], rows: [["261009A0042", "新欄位"]] }],
        })
    );
    const cols = (db.prepare(`PRAGMA table_info("i_orders")`).all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(cols.includes("m_NewCol"));
});

test("applyOps: delete_in works in chunks, and a failing op rolls everything back", async () => {
    const { parseOps, applyOps, getYjcDb, PosImportError } = await import("./yjc-db");
    const db = getYjcDb();
    const many = Array.from({ length: 1200 }, (_, i) => `X${i}`);
    applyOps(
        parseOps({
            ops: [
                { table: "i_seat", op: "clear" },
                { table: "i_seat", op: "insert", columns: ["s_id"], rows: many.map((v) => [v]) },
            ],
        })
    );
    applyOps(parseOps({ ops: [{ table: "i_seat", op: "delete_in", column: "s_id", values: many.slice(0, 1100) }] }));
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM i_seat`).get() as { c: number }).c, 100);

    assert.throws(
        () =>
            applyOps(
                parseOps({
                    ops: [
                        { table: "i_seat", op: "clear" },
                        { table: "i_seat", op: "delete_in", column: "no_such_col", values: ["1"] },
                    ],
                })
            ),
        PosImportError
    );
    // clear 已被 rollback
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM i_seat`).get() as { c: number }).c, 100);
});
