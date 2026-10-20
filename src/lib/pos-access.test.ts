// Unit tests for POS access rule. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

// pos-access 會 import next/navigation 與 prisma；只測純函式，動態載入避免副作用
test("posTenantAllowlist: 逗號分隔、去空白、轉小寫、略過空項", async () => {
    const { posTenantAllowlist } = await import("./pos-access");
    assert.deepEqual(posTenantAllowlist("Default, 洪記軒 ,,demoX"), ["default", "洪記軒", "demox"]);
    assert.deepEqual(posTenantAllowlist(""), []);
    assert.deepEqual(posTenantAllowlist(undefined), []);
    assert.deepEqual(posTenantAllowlist(" , "), []);
});

test("canViewPos: 只有清單內的租戶可以看（不分大小寫、不分角色）", async () => {
    const { canViewPos } = await import("./pos-access");
    const allow = ["default"];
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: "default" }, allow), true);
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: "DEFAULT" }, allow), true);
    assert.equal(canViewPos({ tenantId: "t2", tenantCode: "demo" }, allow), false);
    assert.equal(canViewPos({ tenantId: "t3", tenantCode: "新租戶" }, allow), false);
});

test("canViewPos: 清單為空 = 沒有人能看", async () => {
    const { canViewPos } = await import("./pos-access");
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: "default" }, []), false);
});

test("canViewPos: 沒有 env 時預設拒絕，設了 env 才放行", async () => {
    const { canViewPos } = await import("./pos-access");
    const saved = process.env.POS_TENANT_CODES;
    try {
        delete process.env.POS_TENANT_CODES;
        assert.equal(canViewPos({ tenantId: "t1", tenantCode: "default" }), false);
        process.env.POS_TENANT_CODES = "default,other";
        assert.equal(canViewPos({ tenantId: "t1", tenantCode: "Default" }), true);
        assert.equal(canViewPos({ tenantId: "t1", tenantCode: "demo" }), false);
    } finally {
        if (saved === undefined) delete process.env.POS_TENANT_CODES;
        else process.env.POS_TENANT_CODES = saved;
    }
});

test("canViewPos: no user or no tenant context is denied", async () => {
    const { canViewPos } = await import("./pos-access");
    assert.equal(canViewPos(null, ["default"]), false);
    assert.equal(canViewPos({ tenantId: null, tenantCode: null }, ["default"]), false);
    assert.equal(canViewPos({ tenantId: "t1", tenantCode: null }, ["default"]), false);
});
