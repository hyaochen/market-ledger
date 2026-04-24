// Unit tests for password hashing + lazy rehash detection.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

test("hashPassword: produces bcrypt hash", () => {
    const h = hashPassword("secret123");
    assert.ok(h.startsWith("$2a$") || h.startsWith("$2b$") || h.startsWith("$2y$"));
    assert.notEqual(h, "secret123");
});

test("verifyPassword: bcrypt roundtrip, no rehash needed", () => {
    const h = hashPassword("hunter2");
    const r = verifyPassword("hunter2", h);
    assert.equal(r.ok, true);
    assert.equal(r.needsRehash, false);
});

test("verifyPassword: bcrypt wrong password rejected", () => {
    const h = hashPassword("correct");
    const r = verifyPassword("wrong", h);
    assert.equal(r.ok, false);
    assert.equal(r.needsRehash, false);
});

test("verifyPassword: legacy SHA-256 validates + needsRehash=true", () => {
    const legacy = createHash("sha256").update("old-pass").digest("hex");
    const r = verifyPassword("old-pass", legacy);
    assert.equal(r.ok, true, "legacy SHA-256 should verify");
    assert.equal(r.needsRehash, true, "legacy hash must flag for upgrade");
});

test("verifyPassword: legacy SHA-256 wrong password rejected", () => {
    const legacy = createHash("sha256").update("real").digest("hex");
    const r = verifyPassword("fake", legacy);
    assert.equal(r.ok, false);
    assert.equal(r.needsRehash, false);
});

test("verifyPassword: empty stored hash rejects", () => {
    const r = verifyPassword("anything", "");
    assert.equal(r.ok, false);
});

test("verifyPassword: garbage stored hash rejects cleanly", () => {
    const r = verifyPassword("anything", "not-a-hash");
    assert.equal(r.ok, false);
    assert.equal(r.needsRehash, false);
});

test("verifyPassword: stored hash wrong length SHA-256 rejects", () => {
    // 63 chars instead of 64 — shouldn't match isSha256Hex
    const r = verifyPassword("anything", "a".repeat(63));
    assert.equal(r.ok, false);
});

test("hashPassword: different salts produce different hashes for same input", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    assert.notEqual(a, b, "bcrypt should salt randomly");
    // both should still verify
    assert.equal(verifyPassword("same", a).ok, true);
    assert.equal(verifyPassword("same", b).ok, true);
});
