// Unit tests for the sync-trigger summary (pure functions). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLastRun, describePush, describeRoute, summarizeSync, type SyncStatus } from "./pos-sync";

const okStatus: SyncStatus = {
    ok: true,
    running: false,
    last_run: {
        status: "ok",
        server: "26.96.82.140,9093",
        seconds: 7.9,
        removed_orders: [],
        groups: {
            orders: { changed: 1, new: 2, rows: 17, new_keys: ["261009A0041", "261009A0042"], changed_keys: ["261009A0040"] },
        },
        finished_at: "2026-10-09 21:14:37",
    },
    last_push: { at: "2026-10-09 21:26:53", status: "ok", sent_batches: 1, pending_batches: 0, error: "" },
    pending_batches: 0,
};

test("summarizeSync: success lists route, seconds, new/changed/removed and push", () => {
    const s = summarizeSync(okStatus);
    assert.equal(s.tone, "ok");
    assert.match(s.lines[0], /Radmin VPN/);
    assert.match(s.lines[0], /7.9 秒/);
    assert.match(s.lines[1], /新增 2 張單、修改 1 張、POS 端刪除 0 張/);
    assert.match(s.lines[2], /沒有待推批次/);
    assert.deepEqual(s.newOrders, ["261009A0041", "261009A0042"]);
});

test("summarizeSync: LAN server and removed orders", () => {
    const s = summarizeSync({
        ...okStatus,
        last_run: { ...okStatus.last_run, server: "POS-PC\\SQLEXPRESS", removed_orders: ["261009A0030"] },
    });
    assert.match(s.lines[0], /區網/);
    assert.match(s.lines[1], /POS 端刪除 1 張/);
    assert.equal(s.tone, "warn");
    assert.deepEqual(s.removedOrders, ["261009A0030"]);
});

test("summarizeSync: unreachable POS gets the plain-language message", () => {
    const s = summarizeSync({ last_run: { status: "unreachable", seconds: 15 } });
    assert.equal(s.tone, "bad");
    assert.match(s.headline, /連不到 POS（POS 關機、熱點或 VPN 未連線）/);
});

test("summarizeSync: failed run shows error", () => {
    const s = summarizeSync({ last_run: { status: "failed", error: "boom" } });
    assert.equal(s.headline, "同步失敗");
    assert.ok(s.lines.some((l) => l.includes("boom")));
});

test("describePush covers each status", () => {
    assert.equal(describePush({ status: "ok", pending_batches: 0 }).tone, "ok");
    assert.equal(describePush({ status: "ok", pending_batches: 3 }).tone, "warn");
    assert.equal(describePush({ status: "unreachable", pending_batches: 2 }).tone, "warn");
    assert.equal(describePush({ status: "rejected", pending_batches: 1, error: "401" }).tone, "bad");
    assert.equal(describePush({ status: "not_configured" }).tone, "bad");
    assert.equal(describePush(null).tone, "warn");
});

test("describeRoute and describeLastRun", () => {
    assert.equal(describeRoute("26.1.2.3,9093"), "Radmin VPN");
    assert.equal(describeRoute("POS-PC\\SQLEXPRESS"), "區網");
    assert.match(describeLastRun(okStatus).text, /2026-10-09 21:14:37：成功（Radmin VPN）/);
    assert.match(describeLastRun(null).text, /未連上/);
    assert.match(describeLastRun({ running: true }).text, /進行中/);
    assert.match(describeLastRun({ last_run: { status: "unreachable", finished_at: "x" } }).text, /連不到 POS/);
});
