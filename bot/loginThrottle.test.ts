// 登入節流 + log 遮蔽/輪替 + session 重新驗證的單元測試（全部用注入的假 store / 暫存目錄，不碰真 DB）
// Run: npm test（需在 scripts/run-tests.ts 註冊，或直接 tsx --test bot/loginThrottle.test.ts）

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    LoginThrottle, ThrottleStore, ThrottleRecord, formatWait,
    MAX_FAILURES, WINDOW_MS, BASE_LOCK_MS,
} from "./loginThrottle";
import { rotateIfNeeded, redactLoginText } from "./botLog";
import { revalidateSession, resolveRoleCode } from "./auth";
import type { SessionData } from "./types";

function memStore(): ThrottleStore & { map: Map<string, ThrottleRecord> } {
    const map = new Map<string, ThrottleRecord>();
    return {
        map,
        async get(k) { const v = map.get(k); return v ? JSON.parse(JSON.stringify(v)) : null; },
        async set(k, r) { map.set(k, JSON.parse(JSON.stringify(r))); },
        async del(k) { map.delete(k); },
    };
}

function setup() {
    let t = 1_000_000;
    const store = memStore();
    const th = new LoginThrottle(store, () => t);
    return { th, store, advance: (ms: number) => { t += ms; } };
}

const KEYS = { telegramId: 111, username: "mom" };

test("前 4 次失敗不鎖，第 5 次鎖 15 分鐘", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
        const r = await th.recordFailure(KEYS);
        assert.equal(r.locked, false);
        assert.deepEqual(await th.check(KEYS), { locked: false });
    }
    const last = await th.recordFailure(KEYS);
    assert.equal(last.locked, true);
    const c = await th.check(KEYS);
    assert.equal(c.locked, true);
    if (c.locked) assert.equal(c.retryAfterMs, BASE_LOCK_MS);
});

test("鎖定期滿後可再試；視窗外的舊失敗不累計", async () => {
    const { th, advance } = setup();
    for (let i = 0; i < MAX_FAILURES; i++) await th.recordFailure(KEYS);
    assert.equal((await th.check(KEYS)).locked, true);
    advance(BASE_LOCK_MS + 1);
    assert.equal((await th.check(KEYS)).locked, false);

    const fresh = setup();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await fresh.th.recordFailure(KEYS);
    fresh.advance(WINDOW_MS + 1);
    const r = await fresh.th.recordFailure(KEYS);
    assert.equal(r.locked, false, "舊失敗已超出 15 分鐘視窗");
});

test("重複鎖定指數退避：15 -> 30 -> 60 分鐘", async () => {
    const { th, advance } = setup();
    const waits: number[] = [];
    for (let round = 0; round < 3; round++) {
        let res: Awaited<ReturnType<typeof th.recordFailure>> = { locked: false };
        for (let i = 0; i < MAX_FAILURES; i++) res = await th.recordFailure(KEYS);
        assert.equal(res.locked, true);
        if (res.locked) waits.push(res.retryAfterMs);
        advance(waits[waits.length - 1] + 1);
    }
    assert.deepEqual(waits, [BASE_LOCK_MS, BASE_LOCK_MS * 2, BASE_LOCK_MS * 4]);
});

test("換 Telegram 帳號但同一個帳號名稱，仍被鎖（反之亦然）", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_FAILURES; i++) await th.recordFailure({ telegramId: 1, username: "mom" });
    assert.equal((await th.check({ telegramId: 2, username: "mom" })).locked, true);
    assert.equal((await th.check({ telegramId: 1, username: "other" })).locked, true);
    assert.equal((await th.check({ telegramId: 3, username: "other" })).locked, false);
});

test("帳號名稱大小寫不影響計數", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_FAILURES; i++) await th.recordFailure({ telegramId: i + 10, username: i % 2 ? "MOM" : "mom" });
    assert.equal((await th.check({ telegramId: 99, username: "Mom" })).locked, true);
});

test("登入成功清掉失敗計數與退避等級", async () => {
    const { th, store } = setup();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await th.recordFailure(KEYS);
    await th.recordSuccess(KEYS);
    assert.equal(store.map.size, 0);
    const r = await th.recordFailure(KEYS);
    assert.equal(r.locked, false);
});

test("store 壞掉時 fail-open，不會把人鎖在外面也不丟例外", async () => {
    const broken: ThrottleStore = {
        async get() { throw new Error("db down"); },
        async set() { throw new Error("db down"); },
        async del() { throw new Error("db down"); },
    };
    const th = new LoginThrottle(broken);
    assert.deepEqual(await th.check(KEYS), { locked: false });
    assert.deepEqual(await th.recordFailure(KEYS), { locked: false });
    await th.recordSuccess(KEYS);
});

test("formatWait", () => {
    assert.equal(formatWait(15 * 60 * 1000), "15 分鐘");
    assert.equal(formatWait(30 * 1000), "1 分鐘");
    assert.equal(formatWait(60 * 60 * 1000), "1 小時");
    assert.equal(formatWait(90 * 60 * 1000), "1 小時 30 分鐘");
});

// ── log 遮蔽與輪替 ─────────────────────────────────────────────

test("redactLoginText：不回傳密碼，各種格式都遮蔽", () => {
    for (const raw of ["mom mom123", "mom/mom123", "帳號mom 密碼mom123", "帳號 mom 密碼 mom123"]) {
        const out = redactLoginText(raw);
        assert.ok(!out.includes("mom123"), `密碼外洩於 ${out}`);
        assert.equal(out, "mom [password redacted]");
    }
    assert.equal(redactLoginText("今天 肝連2.6台斤218 好多字"), "[unrecognized login format]");
});

test("rotateIfNeeded：超過上限輪替並只保留 2 份舊檔", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "botlog-"));
    const file = path.join(dir, "bot.log");
    try {
        fs.writeFileSync(file, "x".repeat(100));
        assert.equal(rotateIfNeeded(file, 50, 2), true);
        assert.equal(fs.existsSync(file), false);
        assert.equal(fs.readFileSync(`${file}.1`, "utf8").length, 100);

        fs.writeFileSync(file, "y".repeat(100));
        assert.equal(rotateIfNeeded(file, 50, 2), true);
        assert.equal(fs.readFileSync(`${file}.2`, "utf8"), "x".repeat(100));
        assert.equal(fs.readFileSync(`${file}.1`, "utf8"), "y".repeat(100));

        fs.writeFileSync(file, "z".repeat(100));
        assert.equal(rotateIfNeeded(file, 50, 2), true);
        assert.equal(fs.readFileSync(`${file}.2`, "utf8"), "y".repeat(100), "最舊那份被丟掉");
        assert.equal(fs.existsSync(`${file}.3`), false);

        fs.writeFileSync(file, "small");
        assert.equal(rotateIfNeeded(file, 50, 2), false, "未超過上限不輪替");
        assert.equal(rotateIfNeeded(path.join(dir, "nope.log"), 50, 2), false, "檔案不存在不丟例外");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ── session 重新驗證 ───────────────────────────────────────────

const SESSION: SessionData = {
    userId: "u1", tenantId: "t1", username: "mom", realName: "測試阿姨",
    roleCode: "write", tenantName: "測試商行", expires: new Date(Date.now() + 86400000).toISOString(),
};
const userRow = (over: Record<string, unknown> = {}) => ({
    status: true, tenantId: "t1", username: "mom", realName: "測試阿姨",
    roles: [{ role: { code: "write" } }], tenant: { status: true, name: "測試商行" },
    ...over,
}) as Parameters<typeof revalidateSession>[1];

test("resolveRoleCode：admin > write > read", () => {
    assert.equal(resolveRoleCode(["read", "admin"]), "admin");
    assert.equal(resolveRoleCode(["write", "read"]), "write");
    assert.equal(resolveRoleCode([]), "read");
});

test("revalidateSession：正常使用者原樣通過，到期日不變", () => {
    const r = revalidateSession(SESSION, userRow());
    assert.deepEqual(r, SESSION);
});

test("revalidateSession：停用 / 刪除 / 換租戶 / 租戶停用 -> 作廢", () => {
    assert.equal(revalidateSession(SESSION, null), null);
    assert.equal(revalidateSession(SESSION, userRow({ status: false })), null);
    assert.equal(revalidateSession(SESSION, userRow({ tenantId: "t2" })), null);
    assert.equal(revalidateSession(SESSION, userRow({ tenantId: null })), null);
    assert.equal(revalidateSession(SESSION, userRow({ tenant: { status: false, name: "測試商行" } })), null);
});

test("revalidateSession：降成唯讀 -> 作廢；升成 admin -> 刷新角色", () => {
    assert.equal(revalidateSession(SESSION, userRow({ roles: [{ role: { code: "read" } }] })), null);
    const up = revalidateSession(SESSION, userRow({ roles: [{ role: { code: "admin" } }, { role: { code: "write" } }] }));
    assert.equal(up?.roleCode, "admin");
    assert.equal(up?.expires, SESSION.expires);
});
