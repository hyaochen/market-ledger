// Unit tests for HMAC-signed session tokens.
// Run: npm test
// NOTE: SESSION_SECRET is set in the `test` npm script (cross-platform via the
// test runner invocation), since session.ts reads it at module load time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { signSession, verifySession } from "./session";

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
    // Flip a byte in sig
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
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
