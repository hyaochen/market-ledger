// IPv6 收斂與「已知裝置豁免帳號層鎖定」的單元測試（純記憶體，不碰 DB）。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    MAX_ATTEMPTS_PER_IP,
    MAX_ATTEMPTS_PER_IP_USER,
    _resetLoginLimiterForTest,
    releaseLoginAttempt,
    reserveLoginAttempt,
    reserveTrustedAttempt,
    throttleKeyForIp,
} from "./login-limiter";

beforeEach(() => _resetLoginLimiterForTest());

// ---- IPv6 收斂 ----
test("throttleKeyForIp：IPv4 原樣，IPv4-mapped IPv6 當 IPv4", () => {
    assert.equal(throttleKeyForIp("203.0.113.7"), "203.0.113.7");
    assert.equal(throttleKeyForIp("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(throttleKeyForIp("::FFFF:cb00:7107"), "203.0.113.7");
});

test("throttleKeyForIp：同一個 /64 不同位址 得到同一個 key；不同 /64 得到不同 key", () => {
    const a = throttleKeyForIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    assert.equal(a, throttleKeyForIp("2001:db8:1:2::1"));
    assert.equal(a, throttleKeyForIp("2001:DB8:1:2:ffff:ffff:ffff:ffff"));
    assert.notEqual(a, throttleKeyForIp("2001:db8:1:3::1"));
    assert.notEqual(a, throttleKeyForIp("2001:db9:1:2::1"));
});

test("throttleKeyForIp：:: 壓縮正確展開，zone id 與中括號被忽略", () => {
    assert.equal(throttleKeyForIp("2001:db8::1"), throttleKeyForIp("2001:db8:0:0:0:0:0:1"));
    assert.equal(throttleKeyForIp("2001:db8::"), throttleKeyForIp("2001:0db8:0:0::ffff"));
    assert.equal(throttleKeyForIp("::1"), throttleKeyForIp("0:0:0:0:ffff::1"));
    assert.equal(throttleKeyForIp("fe80::1%eth0"), throttleKeyForIp("fe80::2"));
    assert.equal(throttleKeyForIp("[2001:db8:1:2::9]"), throttleKeyForIp("2001:db8:1:2::1"));
});

test("throttleKeyForIp：無法解析的字串原樣截斷（不丟例外）", () => {
    assert.equal(throttleKeyForIp("unknown"), "unknown");
    assert.equal(throttleKeyForIp("垃圾:::字串"), "垃圾:::字串");
    assert.equal(throttleKeyForIp("1:2:3:4:5:6:7:8:9"), "1:2:3:4:5:6:7:8:9");
    assert.equal(throttleKeyForIp("2001::db8::1"), "2001::db8::1");
    assert.equal(throttleKeyForIp("999.1.1.1"), "999.1.1.1");
    assert.equal(throttleKeyForIp("x".repeat(200)).length, 64);
});

test("同一個 /64 換位址仍累計在同一個 IP+帳號層", () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) {
        const key = throttleKeyForIp(`2001:db8:5:6::${i + 1}`);
        assert.equal(reserveLoginAttempt(key, "老闆").allowed, true);
    }
    const r = reserveLoginAttempt(throttleKeyForIp("2001:db8:5:6:1:2:3:4"), "老闆");
    assert.equal(r.allowed, false);
});

// ---- 已知裝置：帳號層豁免 ----
function lockUserLayer() {
    // 10 個不同 IP、各 5 次 = 50 次，帳號層鎖定
    for (let ip = 1; ip <= 10; ip++) {
        for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) reserveLoginAttempt(`10.0.0.${ip}`, "老闆");
    }
}

test("帳號層被鎖：新 IP 先被擋（scope = user）；已知裝置走 reserveTrustedAttempt 可通過", () => {
    lockUserLayer();
    const r = reserveLoginAttempt("8.8.8.8", "老闆");
    assert.equal(r.allowed, false);
    if (!r.allowed) assert.equal(r.scope, "user");
    assert.equal(reserveTrustedAttempt("8.8.8.8", "老闆").allowed, true);
});

test("已知裝置通過後仍累計 IP+帳號層：第 6 次被擋（scope = ip-user）", () => {
    lockUserLayer();
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) {
        assert.equal(reserveTrustedAttempt("8.8.8.8", "老闆").allowed, true);
    }
    const r = reserveTrustedAttempt("8.8.8.8", "老闆");
    assert.equal(r.allowed, false);
    if (!r.allowed) assert.equal(r.scope, "ip-user");
});

test("已知裝置也受 IP 層限制（30 次）", () => {
    lockUserLayer();
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP; i++) {
        assert.equal(reserveTrustedAttempt("8.8.4.4", `帳號${i}`).allowed, true);
    }
    const r = reserveTrustedAttempt("8.8.4.4", "老闆");
    assert.equal(r.allowed, false);
    if (!r.allowed) assert.equal(r.scope, "ip");
});

test("沒有已知裝置：帳號層鎖定照舊擋住", () => {
    lockUserLayer();
    for (let i = 0; i < 3; i++) {
        const r = reserveLoginAttempt("8.8.8.8", "老闆");
        assert.equal(r.allowed, false);
        if (!r.allowed) assert.equal(r.scope, "user");
    }
});

test("已知裝置路徑不累計帳號層，成功後 skipUser 不會把別人的累計退掉", () => {
    lockUserLayer();
    assert.equal(reserveTrustedAttempt("8.8.8.8", "老闆").allowed, true);
    releaseLoginAttempt("8.8.8.8", "老闆", { skipUser: true });
    assert.equal(reserveLoginAttempt("7.7.7.7", "老闆").allowed, false); // 帳號層仍是 50
    assert.equal(reserveTrustedAttempt("8.8.8.8", "老闆").allowed, true); // IP+帳號已清掉，同裝置可再來
});
