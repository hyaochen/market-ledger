// 登入限流器的單元測試（純記憶體，不碰 DB）。Run: npm test
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    LOCKOUT_MS,
    MAX_ATTEMPTS_PER_IP_USER,
    MAX_ATTEMPTS_PER_USER,
    MAX_TRACKED_KEYS,
    _limiterSizesForTest,
    _resetLoginLimiterForTest,
    clientIpFromHeaders,
    releaseLoginAttempt,
    reserveLoginAttempt,
} from "./login-limiter";

beforeEach(() => _resetLoginLimiterForTest());

test("同一 IP + 帳號：第 6 次起被鎖，且只有第一次被鎖會要求寫 log", () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) {
        assert.equal(reserveLoginAttempt("1.1.1.1", "老闆", t + i).allowed, true);
    }
    const r = reserveLoginAttempt("1.1.1.1", "老闆", t + 10);
    assert.equal(r.allowed, false);
    if (!r.allowed) {
        assert.equal(r.scope, "ip-user");
        assert.equal(r.shouldLog, true);
        assert.ok(r.retryMinutes >= 1 && r.retryMinutes <= 15);
    }
    const r2 = reserveLoginAttempt("1.1.1.1", "老闆", t + 20);
    assert.equal(r2.allowed, false);
    if (!r2.allowed) assert.equal(r2.shouldLog, false);
});

test("一個 IP 被鎖，不會把其他 IP 的同一帳號鎖在門外", () => {
    for (let i = 0; i < 20; i++) reserveLoginAttempt("9.9.9.9", "admin");
    assert.equal(reserveLoginAttempt("9.9.9.9", "admin").allowed, false);
    assert.equal(reserveLoginAttempt("2.2.2.2", "admin").allowed, true);
});

test("帳號大小寫不同視為同一組（不能靠改大小寫繞過）", () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) reserveLoginAttempt("3.3.3.3", "Admin");
    assert.equal(reserveLoginAttempt("3.3.3.3", "ADMIN").allowed, false);
});

test("換 IP 輪流猜同一帳號：累計到帳號層上限後全面鎖定", () => {
    let blocked = 0;
    for (let i = 0; i < MAX_ATTEMPTS_PER_USER + 5; i++) {
        const r = reserveLoginAttempt(`10.0.${Math.floor(i / 200)}.${i % 200}`, "chen");
        if (!r.allowed) {
            blocked++;
            assert.equal(r.scope, "user");
        }
    }
    assert.equal(blocked, 5);
});

test("預約是同步的：一波並發請求中只有 5 個能通過", async () => {
    const results = await Promise.all(
        Array.from({ length: 50 }, async () => reserveLoginAttempt("4.4.4.4", "mom")),
    );
    assert.equal(results.filter((r) => r.allowed).length, MAX_ATTEMPTS_PER_IP_USER);
});

test("登入成功 release 後，IP+帳號的次數歸零、帳號層退回一次", () => {
    for (let i = 0; i < 4; i++) reserveLoginAttempt("5.5.5.5", "1");
    reserveLoginAttempt("5.5.5.5", "1");
    releaseLoginAttempt("5.5.5.5", "1");
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) {
        assert.equal(reserveLoginAttempt("5.5.5.5", "1").allowed, true);
    }
});

test("鎖定時間過後自動解鎖", () => {
    const t = 5_000_000;
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) reserveLoginAttempt("6.6.6.6", "u", t);
    assert.equal(reserveLoginAttempt("6.6.6.6", "u", t + 1000).allowed, false);
    assert.equal(reserveLoginAttempt("6.6.6.6", "u", t + LOCKOUT_MS + 1).allowed, true);
});

test("Map 有上限：灌入大量不同 key 不會無限成長，過期項目會被清掉", () => {
    for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) {
        reserveLoginAttempt(`ip-${i}`, `user-${i}`, 1000);
    }
    assert.ok(_limiterSizesForTest().ipUser <= MAX_TRACKED_KEYS);
    assert.ok(_limiterSizesForTest().user <= MAX_TRACKED_KEYS);
    // 全部過期後再來一筆，會先清掉過期的
    reserveLoginAttempt("fresh-ip", "fresh-user", 1000 + LOCKOUT_MS + 1);
    assert.ok(_limiterSizesForTest().ipUser < 100);
});

test("clientIpFromHeaders：cf-connecting-ip 優先，其次 x-forwarded-for 第一段，否則 unknown", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    assert.equal(clientIpFromHeaders(h({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
    assert.equal(clientIpFromHeaders(h({ "x-forwarded-for": "7.7.7.7, 8.8.8.8" })), "7.7.7.7");
    assert.equal(clientIpFromHeaders(h({})), "unknown");
});
