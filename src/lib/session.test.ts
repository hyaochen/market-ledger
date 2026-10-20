// Unit tests for HMAC-signed session tokens.
// Run: npm test
// NOTE: SESSION_SECRET is set in the `test` npm script (cross-platform via the
// test runner invocation), since session.ts reads it at module load time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession, passwordFingerprint } from "./session";

test("signSession + verifySession: roundtrip preserves payload", () => {
    const payload = {
        userId: "u123",
        tenantId: "t456",
        isSuperAdmin: false,
        issuedAt: Date.now(),
    };
    const token = signSession(payload);
    const decoded = verifySession(token);
    assert.deepEqual(decoded, payload);
});

test("verifySession: null/empty returns null", () => {
    assert.equal(verifySession(null), null);
    assert.equal(verifySession(undefined), null);
    assert.equal(verifySession(""), null);
});

test("verifySession: malformed token returns null", () => {
    assert.equal(verifySession("no-dot-separator"), null);
    assert.equal(verifySession("abc.def.ghi"), null);
});

test("verifySession: tampered signature rejected", () => {
    const token = signSession({ userId: "u1", tenantId: null, isSuperAdmin: false, issuedAt: Date.now() });
    const [payload, sig] = token.split(".");
    // [重要] 2026-08-09 主控 spot-check：這裡原本翻的是 sig 的「最後一個」字元，會
    // flaky（實測連跑 3 次會失敗 1 次）。原因是簽章是 base64url 的 HMAC-SHA256
    // （32 bytes → 43 字元），最後一個字元只承載 4 個有效 bit，低 2 bit 在解碼時
    // 直接被丟棄 —— 所以把它換成「同一組」的另一個字元（例如 B→A），解出來的
    // bytes 完全相同、簽章依舊有效，verifySession 正確地回傳 session，但測試卻
    // 期待 null 而失敗。翻「第一個」字元則一定承載完整 6 bit，改了必然改變解碼
    // 結果，這個測試就變成確定性的。
    const tamperedSig = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
    assert.notEqual(tamperedSig, sig);
    assert.equal(verifySession(`${payload}.${tamperedSig}`), null);
});

test("verifySession: tampered payload (signature no longer matches) rejected", () => {
    const token = signSession({ userId: "u1", tenantId: null, isSuperAdmin: false, issuedAt: Date.now() });
    const [, sig] = token.split(".");
    // Put a different payload with the original signature
    const fakePayload = Buffer.from(JSON.stringify({ userId: "hacker", tenantId: null, isSuperAdmin: true, issuedAt: Date.now() })).toString("base64url");
    assert.equal(verifySession(`${fakePayload}.${sig}`), null);
});

test("verifySession: expired token (>30 days) rejected", () => {
    const expired = signSession({
        userId: "u1",
        tenantId: null,
        isSuperAdmin: false,
        issuedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });
    assert.equal(verifySession(expired), null);
});

test("verifySession: super admin flag preserved", () => {
    const token = signSession({ userId: "root", tenantId: null, isSuperAdmin: true, issuedAt: Date.now() });
    const decoded = verifySession(token);
    assert.equal(decoded?.isSuperAdmin, true);
    assert.equal(decoded?.tenantId, null);
});

test("getSecret: production 沒設 SESSION_SECRET 時，每一次呼叫都 throw（不得 fail-open 改用 fallback）", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { n: env.NODE_ENV, s: env.SESSION_SECRET, p: env.NEXT_PHASE };
    try {
        env.NODE_ENV = "production";
        delete env.SESSION_SECRET;
        delete env.NEXT_PHASE;
        const payload = { userId: "u1", tenantId: null, isSuperAdmin: false, issuedAt: Date.now() };
        for (let i = 0; i < 3; i++) {
            assert.throws(() => signSession(payload), /SESSION_SECRET/);
            assert.throws(() => verifySession("a.b"), /SESSION_SECRET/);
        }
        // secret 太短也一樣每次都擋
        env.SESSION_SECRET = "short";
        for (let i = 0; i < 3; i++) assert.throws(() => signSession(payload), /too short/);
        // 公開 fallback 常數在 production 不可用
        env.SESSION_SECRET = "dev-secret-should-be-changed";
        assert.throws(() => signSession(payload), /development default/);
        // 補上合法 secret 後恢復正常
        env.SESSION_SECRET = "x".repeat(40);
        assert.ok(signSession(payload));
    } finally {
        env.NODE_ENV = saved.n;
        if (saved.s === undefined) delete env.SESSION_SECRET; else env.SESSION_SECRET = saved.s;
        if (saved.p === undefined) delete env.NEXT_PHASE; else env.NEXT_PHASE = saved.p;
    }
});

test("getSecret: secret 在檢查當下才讀 env（模組載入後改 env 會生效）", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.SESSION_SECRET;
    try {
        env.SESSION_SECRET = "k".repeat(40);
        const token = signSession({ userId: "u1", tenantId: null, isSuperAdmin: false, issuedAt: Date.now() });
        env.SESSION_SECRET = "z".repeat(40);
        assert.equal(verifySession(token), null);
        env.SESSION_SECRET = "k".repeat(40);
        assert.equal(verifySession(token)?.userId, "u1");
    } finally {
        if (saved === undefined) delete env.SESSION_SECRET; else env.SESSION_SECRET = saved;
    }
});

test("passwordFingerprint: 同 hash 穩定、不同 hash 不同、不含 hash 本身", () => {
    const a = passwordFingerprint("hash-A");
    assert.equal(a, passwordFingerprint("hash-A"));
    assert.notEqual(a, passwordFingerprint("hash-B"));
    assert.ok(!a.includes("hash-A"));
});
