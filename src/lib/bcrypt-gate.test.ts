// 密碼驗證併發閘門的單元測試（純邏輯）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "./bcrypt-gate";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}
const tick = () => new Promise<void>((r) => setImmediate(r));

test("閘門：超過同時上限會排隊，不會同時執行", async () => {
    const gate = createGate(2, 10);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const jobs = gates.map((d) =>
        gate.run(async () => {
            active++;
            peak = Math.max(peak, active);
            await d.promise;
            active--;
            return "ok";
        }),
    );
    await tick();
    assert.deepEqual(gate.stats(), { running: 2, waiting: 3 });
    for (const d of gates) { d.resolve(); await tick(); }
    const results = await Promise.all(jobs);
    assert.equal(peak, 2);
    assert.ok(results.every((r) => !r.busy));
    assert.deepEqual(gate.stats(), { running: 0, waiting: 0 });
});

test("閘門：等待的人超過上限直接回 busy，而且不執行", async () => {
    const gate = createGate(1, 2);
    const hold = deferred();
    let executed = 0;
    const fn = async () => { executed++; await hold.promise; };
    const jobs = [gate.run(fn), gate.run(fn), gate.run(fn)]; // 1 執行 + 2 等待
    await tick();
    const rejected = await gate.run(fn);
    assert.equal(rejected.busy, true);
    assert.equal(executed, 1);
    hold.resolve();
    await Promise.all(jobs);
    assert.equal(executed, 3);
});

test("閘門：釋放後恢復接受新工作；工作丟例外也會釋放名額", async () => {
    const gate = createGate(1, 0);
    await assert.rejects(gate.run(async () => { throw new Error("爆了"); }));
    assert.deepEqual(gate.stats(), { running: 0, waiting: 0 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    await tick();
    assert.equal((await gate.run(async () => 1)).busy, true); // 滿了且不准等待
    hold.resolve();
    await first;
    const after = await gate.run(async () => "恢復");
    assert.deepEqual(after, { busy: false, value: "恢復" });
});
