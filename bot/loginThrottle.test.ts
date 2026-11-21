// 登入節流 + log 遮蔽/輪替 + session 重新驗證的單元測試（全部用注入的假 store / 暫存目錄，不碰真 DB）
// Run: npm test（需在 scripts/run-tests.ts 註冊，或直接 tsx --test bot/loginThrottle.test.ts）

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    LoginThrottle, ThrottleStore, ThrottleRecord, KnownStore, formatWait,
    MAX_FAILURES, MAX_USERNAME_FAILURES, WINDOW_MS, BASE_LOCK_MS,
    MAX_LOCK_MS, MAX_USERNAME_LOCK_MS, MAX_KNOWN_USERNAMES,
} from "./loginThrottle";
import { rotateIfNeeded, redactLoginText, usernameTag } from "./botLog";
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

function memKnown(): KnownStore & { map: Map<string, string[]> } {
    const map = new Map<string, string[]>();
    return {
        map,
        async get(id) { return [...(map.get(String(id)) ?? [])]; },
        async set(id, names) { map.set(String(id), [...names]); },
    };
}

function setup() {
    let t = 1_000_000;
    const store = memStore();
    const known = memKnown();
    const th = new LoginThrottle(store, () => t, known);
    return { th, store, known, advance: (ms: number) => { t += ms; } };
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

test("單一 Telegram 帳號打錯 5 次只鎖它自己，不會把真正的帳號主人鎖在門外", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_FAILURES; i++) await th.recordFailure({ telegramId: 1, username: "mom" });
    assert.equal((await th.check({ telegramId: 1, username: "other" })).locked, true);
    assert.equal((await th.check({ telegramId: 2, username: "mom" })).locked, false);
});

test("帳號名稱跨多個 Telegram 帳號累計到門檻才鎖", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_USERNAME_FAILURES - 1; i++) await th.recordFailure({ telegramId: 100 + i, username: "mom" });
    assert.equal((await th.check({ telegramId: 2, username: "mom" })).locked, false);
    await th.recordFailure({ telegramId: 999, username: "mom" });
    assert.equal((await th.check({ telegramId: 2, username: "mom" })).locked, true);
    assert.equal((await th.check({ telegramId: 3, username: "other" })).locked, false);
});

test("帳號名稱大小寫不影響計數", async () => {
    const { th } = setup();
    for (let i = 0; i < MAX_USERNAME_FAILURES; i++) await th.recordFailure({ telegramId: i + 10, username: i % 2 ? "MOM" : "mom" });
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

test("recordSuccess 只清這個 telegram id 與這個帳號名稱，不動別人的計數", async () => {
    const { th, store } = setup();
    await th.recordFailure({ telegramId: 1, username: "mom" });
    await th.recordFailure({ telegramId: 2, username: "other" });
    await th.recordFailure({ telegramId: 3, username: "mom" });
    assert.equal(store.map.size, 5); // tg1 tg2 tg3 u(mom) u(other)
    await th.recordSuccess({ telegramId: 1, username: "mom" });
    assert.equal(store.map.size, 3); // 清掉 tg1 與 u(mom)；tg2 / tg3 / u(other) 還在
});

test("帳號名稱層鎖定：已知的 telegram id 放行，未知的被擋", async () => {
    const { th } = setup();
    await th.recordSuccess({ telegramId: 100, username: "Mom" }); // 100 成功登入過 mom（大小寫無關）
    for (let i = 0; i < MAX_USERNAME_FAILURES; i++) await th.recordFailure({ telegramId: 500 + i, username: "mom" });
    assert.equal((await th.check({ telegramId: 999, username: "mom" })).locked, true);
    assert.deepEqual(await th.check({ telegramId: 100, username: "mom" }), { locked: false });
    // 已知清單裡沒有的帳號名稱不適用
    for (let i = 0; i < MAX_USERNAME_FAILURES; i++) await th.recordFailure({ telegramId: 600 + i, username: "aunt" });
    assert.equal((await th.check({ telegramId: 100, username: "aunt" })).locked, true);
});

test("已知的 telegram id 自己連續打錯 5 次，telegram id 層照樣鎖（優先於已知放行）", async () => {
    const { th } = setup();
    await th.recordSuccess({ telegramId: 100, username: "mom" });
    for (let i = 0; i < MAX_USERNAME_FAILURES; i++) await th.recordFailure({ telegramId: 500 + i, username: "mom" });
    for (let i = 0; i < MAX_FAILURES; i++) await th.recordFailure({ telegramId: 100, username: "mom" });
    assert.equal((await th.check({ telegramId: 100, username: "mom" })).locked, true);
});

test("帳號名稱層退避上限 1 小時，telegram id 層維持 24 小時", async () => {
    const { th, advance } = setup();
    let lastUser = 0;
    for (let round = 0; round < 6; round++) {
        let res: Awaited<ReturnType<typeof th.recordFailure>> = { locked: false };
        for (let i = 0; i < MAX_USERNAME_FAILURES; i++) res = await th.recordFailure({ telegramId: 1000 + round * 100 + i, username: "mom" });
        assert.equal(res.locked, true);
        if (res.locked) lastUser = res.retryAfterMs;
        advance(lastUser + 1);
    }
    assert.equal(lastUser, MAX_USERNAME_LOCK_MS);

    const tg = setup();
    let lastTg = 0;
    for (let round = 0; round < 8; round++) {
        let res: Awaited<ReturnType<typeof tg.th.recordFailure>> = { locked: false };
        for (let i = 0; i < MAX_FAILURES; i++) res = await tg.th.recordFailure({ telegramId: 1, username: `u${round}` });
        if (res.locked) lastTg = res.retryAfterMs;
        tg.advance(lastTg + 1);
    }
    assert.equal(lastTg, MAX_LOCK_MS);
});

test("已知清單最多 5 個帳號名稱，新的擠掉最舊的，重複登入不重複記", async () => {
    const { th, known } = setup();
    for (const n of ["a", "b", "c", "d", "e", "f", "e"]) await th.recordSuccess({ telegramId: 7, username: n });
    const list = known.map.get("7")!;
    assert.equal(list.length, MAX_KNOWN_USERNAMES);
    assert.deepEqual(list, ["e", "f", "d", "c", "b"]);
});

test("store 壞掉時 fail-open，不會把人鎖在外面也不丟例外", async () => {
    const broken: ThrottleStore = {
        async get() { throw new Error("db down"); },
        async set() { throw new Error("db down"); },
        async del() { throw new Error("db down"); },
    };
    const brokenKnown: KnownStore = {
        async get() { throw new Error("db down"); },
        async set() { throw new Error("db down"); },
    };
    const th = new LoginThrottle(broken, Date.now, brokenKnown);
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
        assert.equal(out, `${usernameTag("mom")} [password redacted]`);
        assert.ok(!out.includes("mom "), `帳號名稱原文外洩於 ${out}`);
    }
    assert.match(usernameTag("Mom"), /^u#[0-9a-f]{8}$/);
    assert.equal(usernameTag("Mom"), usernameTag("mom"), "不分大小寫");
    assert.notEqual(usernameTag("mom"), usernameTag("aunt"));
    // 帳密打反：被當成帳號的其實是密碼，不能原文落地
    assert.ok(!redactLoginText("SuperSecret99 mom").includes("SuperSecret99"));
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
