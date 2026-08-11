// Unit tests for T-ML-031: bot container liveness heartbeat.
//
// Every test injects fake query/writeFile deps -- this file NEVER touches the real
// Prisma client or the real filesystem heartbeat path. That's deliberate: the whole
// point of this task is to stop opening new connections against dev.db from places
// that aren't the bot's own long-running process, so the test suite for the health
// mechanism itself must not become another one of those places.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { runHeartbeatTick, startHeartbeat, HEARTBEAT_FILE, HEARTBEAT_INTERVAL_MS } from "./heartbeat";

// ── runHeartbeatTick ─────────────────────────────────────────────────────────────

test("runHeartbeatTick: successful query writes the timestamp to the given file", async () => {
    let queried = false;
    const writes: { file: string; contents: string }[] = [];

    const result = await runHeartbeatTick({
        query: async () => { queried = true; return [{ "1": 1 }]; },
        writeFile: (file, contents) => { writes.push({ file, contents }); },
        now: () => 1234567890,
        file: "/tmp/fake-heartbeat-test",
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(queried, true, "must actually call the injected query");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].file, "/tmp/fake-heartbeat-test");
    assert.equal(writes[0].contents, "1234567890");
});

test("runHeartbeatTick: failing query does NOT write a file, and does not throw", async () => {
    let wrote = false;

    const result = await runHeartbeatTick({
        query: async () => { throw new Error("SqliteError 522: disk I/O error"); },
        writeFile: () => { wrote = true; },
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /522/);
    assert.equal(wrote, false, "a failed query must leave the heartbeat file stale, not overwrite it with a fresh-looking timestamp");
});

test("runHeartbeatTick: defaults file to HEARTBEAT_FILE and timestamp to Date.now() when not overridden", async () => {
    const writes: { file: string; contents: string }[] = [];
    const before = Date.now();

    await runHeartbeatTick({
        query: async () => undefined, // still overriding query -- never touch real prisma in tests
        writeFile: (file, contents) => { writes.push({ file, contents }); },
    });

    const after = Date.now();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].file, HEARTBEAT_FILE);
    const writtenTs = Number(writes[0].contents);
    assert.ok(Number.isFinite(writtenTs), "written contents must be a numeric timestamp string");
    assert.ok(writtenTs >= before && writtenTs <= after, "timestamp should fall within the call's real wall-clock window");
});

test("runHeartbeatTick: query rejecting with a non-Error value still resolves (never throws out of tick)", async () => {
    const result = await runHeartbeatTick({
        query: async () => { throw "plain string rejection"; },
        writeFile: () => { throw new Error("writeFile must not be reached"); },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "plain string rejection");
});

// ── startHeartbeat ───────────────────────────────────────────────────────────────

test("startHeartbeat: fires an immediate tick without waiting for the first interval", async () => {
    let queryCount = 0;
    const { stop } = startHeartbeat({
        query: async () => { queryCount += 1; },
        writeFile: () => {},
        intervalMs: HEARTBEAT_INTERVAL_MS, // long enough that only the immediate tick could have fired here
    });
    try {
        // runHeartbeatTick's first call is fire-and-forget (`void runHeartbeatTick(...)`);
        // give the microtask/timer queue a turn so it actually runs before asserting.
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(queryCount, 1);
    } finally {
        stop();
    }
});

test("startHeartbeat: stop() prevents further ticks", async () => {
    let queryCount = 0;
    const { stop } = startHeartbeat({
        query: async () => { queryCount += 1; },
        writeFile: () => {},
        intervalMs: 20,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    const countAtStop = queryCount;
    assert.ok(countAtStop >= 1, "should have ticked at least once (immediate + possibly one interval)");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(queryCount, countAtStop, "no further ticks should happen after stop()");
});
