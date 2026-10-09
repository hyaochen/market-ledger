// Unit tests for POS access rule. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

// pos-access 會 import next/navigation 與 prisma；只測純函式，動態載入避免副作用
test("canViewPos: real tenant users of any role are allowed, demo tenant is not", async () => {
    const { canViewPos } = await import("./pos-access");
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: "default" }), true);
    assert.equal(canViewPos({ tenantId: "t2", tenantCode: "demo" }), false);
    assert.equal(canViewPos({ tenantId: "t2", tenantCode: "DEMO" }), false);
});

test("canViewPos: no user or no tenant context is denied", async () => {
    const { canViewPos } = await import("./pos-access");
    assert.equal(canViewPos(null), false);
    assert.equal(canViewPos({ tenantId: null, tenantCode: null }), false);
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: null }), false);
});
