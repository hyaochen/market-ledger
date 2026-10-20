import test from "node:test";
import assert from "node:assert/strict";

// cash-auth 會 import prisma / next；只測純函式，動態載入
test("cashRoleFlags: read 角色不能寫入也不算員工", async () => {
    const { cashRoleFlags } = await import("./cash-auth");
    assert.deepEqual(cashRoleFlags({ roleCode: "read", isSuperAdmin: false }), { isAdmin: false, canWrite: false, isEmployee: false });
});

test("cashRoleFlags: write 是員工且能寫入", async () => {
    const { cashRoleFlags } = await import("./cash-auth");
    assert.deepEqual(cashRoleFlags({ roleCode: "write", isSuperAdmin: false }), { isAdmin: false, canWrite: true, isEmployee: true });
});

test("cashRoleFlags: admin 與 super admin 能寫入但不是員工", async () => {
    const { cashRoleFlags } = await import("./cash-auth");
    assert.deepEqual(cashRoleFlags({ roleCode: "admin", isSuperAdmin: false }), { isAdmin: true, canWrite: true, isEmployee: false });
    assert.deepEqual(cashRoleFlags({ roleCode: "read", isSuperAdmin: true }), { isAdmin: true, canWrite: true, isEmployee: false });
});
