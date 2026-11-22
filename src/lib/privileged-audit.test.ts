// 特權操作稽核內容的純函式測試（不碰 DB）。Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildPasswordResetAudit,
    buildTenantCreateAudit,
    buildTenantStatusAudit,
    buildTenantSwitchAudit,
    buildTenantUpdateAudit,
    buildUserCreateAudit,
    buildUserDeleteAudit,
    buildUserRoleAudit,
    buildUserStatusAudit,
} from "./privileged-audit";

const c = { actorId: "u-actor", ip: "198.51.100.9" };
const parse = (d: { details: string }) => JSON.parse(d.details);

test("user.create：CREATE / USER，target 是帳號名稱，tenantId 是新使用者的租戶", () => {
    const d = buildUserCreateAudit({ ...c, tenantId: "t1", userId: "u1", username: "wang", realName: "王小明", departmentId: "d1", roleCodes: ["read"] });
    assert.equal(d.action, "CREATE");
    assert.equal(d.module, "USER");
    assert.equal(d.target, "wang");
    assert.equal(d.userId, "u-actor");
    assert.equal(d.tenantId, "t1");
    assert.equal(d.ip, "198.51.100.9");
    assert.equal(d.status, "SUCCESS");
    assert.deepEqual(parse(d), {
        op: "user.create",
        userId: "u1",
        before: null,
        after: { username: "wang", realName: "王小明", departmentId: "d1", roleCodes: ["read"], status: true },
    });
});

test("user.status / user.role / user.delete：記變更前與變更後", () => {
    const s = buildUserStatusAudit({ ...c, tenantId: "t1", userId: "u1", username: "wang", before: true, after: false });
    assert.equal(s.action, "UPDATE");
    assert.deepEqual(parse(s), { op: "user.status", userId: "u1", before: { status: true }, after: { status: false } });

    const r = buildUserRoleAudit({ ...c, tenantId: "t1", userId: "u1", username: "wang", beforeRoleCodes: ["read"], afterRoleCode: "admin" });
    assert.equal(r.action, "UPDATE");
    assert.deepEqual(parse(r), { op: "user.role", userId: "u1", before: { roleCodes: ["read"] }, after: { roleCodes: ["admin"] } });

    const x = buildUserDeleteAudit({ ...c, tenantId: "t1", userId: "u1", username: "wang", roleCodes: ["write"], status: false });
    assert.equal(x.action, "DELETE");
    assert.equal(x.target, "wang");
    assert.deepEqual(parse(x), { op: "user.delete", userId: "u1", before: { username: "wang", roleCodes: ["write"], status: false }, after: null });
});

test("user.password_reset：只記誰重設了誰，沒有任何密碼欄位", () => {
    const d = buildPasswordResetAudit({ ...c, tenantId: "t1", userId: "u1", username: "wang" });
    assert.equal(d.module, "USER");
    assert.equal(d.tenantId, "t1");
    const det = parse(d);
    assert.equal(det.op, "user.password_reset");
    assert.equal(det.userId, "u1");
    assert.deepEqual(Object.keys(det).sort(), ["op", "sessionsRevoked", "userId"]);
    // 沒有租戶的使用者（理論上不會發生）也不能炸
    assert.equal(buildPasswordResetAudit({ ...c, tenantId: null, userId: "u2", username: "x" }).tenantId, null);
});

test("tenant.*：target 是企業代碼，tenantId 是被操作的企業", () => {
    const cr = buildTenantCreateAudit({ ...c, tenantId: "t9", code: "co-9", name: "九號企業", note: null, adminUserId: "ua", adminUsername: "admin9" });
    assert.equal(cr.action, "CREATE");
    assert.equal(cr.module, "TENANT");
    assert.equal(cr.target, "co-9");
    assert.equal(cr.tenantId, "t9");
    assert.deepEqual(parse(cr), {
        op: "tenant.create",
        tenantId: "t9",
        before: null,
        after: { code: "co-9", name: "九號企業", note: null, status: true },
        adminUserId: "ua",
        adminUsername: "admin9",
    });

    const up = buildTenantUpdateAudit({ ...c, tenantId: "t9", code: "co-9", before: { name: "舊名", note: null }, after: { name: "新名", note: "備註" } });
    assert.deepEqual(parse(up), { op: "tenant.update", tenantId: "t9", before: { name: "舊名", note: null }, after: { name: "新名", note: "備註" } });

    const st = buildTenantStatusAudit({ ...c, tenantId: "t9", code: "co-9", name: "九號企業", before: true, after: false });
    assert.deepEqual(parse(st), { op: "tenant.status", tenantId: "t9", tenantName: "九號企業", before: { status: true }, after: { status: false } });
});

test("tenant.switch_in / switch_back：AUTH 模組，tenantId 是被進入或離開的企業", () => {
    const i = buildTenantSwitchAudit({ ...c, direction: "in", tenantId: "t9", code: "co-9", name: "九號企業" });
    const b = buildTenantSwitchAudit({ ...c, direction: "back", tenantId: "t9", code: "co-9", name: "九號企業" });
    for (const d of [i, b]) {
        assert.equal(d.module, "AUTH");
        assert.equal(d.action, "SWITCH");
        assert.equal(d.target, "co-9");
        assert.equal(d.tenantId, "t9");
    }
    assert.equal(parse(i).op, "tenant.switch_in");
    assert.equal(parse(b).op, "tenant.switch_back");
});

test("所有 builder 的輸出都不含密碼、雜湊或 token 類欄位（op 名稱除外）", () => {
    const all = [
        buildUserCreateAudit({ ...c, tenantId: "t", userId: "u", username: "n", realName: null, departmentId: null, roleCodes: [] }),
        buildUserStatusAudit({ ...c, tenantId: "t", userId: "u", username: "n", before: true, after: false }),
        buildUserDeleteAudit({ ...c, tenantId: "t", userId: "u", username: "n", roleCodes: [], status: true }),
        buildUserRoleAudit({ ...c, tenantId: "t", userId: "u", username: "n", beforeRoleCodes: [], afterRoleCode: "read" }),
        buildPasswordResetAudit({ ...c, tenantId: "t", userId: "u", username: "n" }),
        buildTenantCreateAudit({ ...c, tenantId: "t", code: "c", name: "n", note: null, adminUserId: "u", adminUsername: "a" }),
    ];
    for (const d of all) assert.doesNotMatch(d.details.replace(/"op":"[^"]*"/, ""), /password|hash|token|secret/i);
});
