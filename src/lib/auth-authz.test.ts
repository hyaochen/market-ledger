// 授權測試：admin / super-admin 的每一個 server action，用「未登入 / read / write / 別的租戶 admin」去呼叫都必須被擋。
// 用一個暫時的 SQLite 檔（prisma db push 建 schema），不碰任何真實資料。
// next/headers、next/cache 用 require.cache 換成替身，才能在 request 之外直接呼叫 server action。
// Run: npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dbFile = path.join(tmpdir(), `ml-authz-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;
const env = process.env as Record<string, string | undefined>;
env.SESSION_SECRET = env.SESSION_SECRET || "a".repeat(40);

// ---- 替身 ----
let currentToken: string | undefined;
let lastSetCookie: { name: string; value: string; opts: Record<string, unknown> } | undefined;
let requestHeaders: Record<string, string> = {};

function stub(id: string, exports: Record<string, unknown>) {
    const resolved = require.resolve(id);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}
stub("next/headers", {
    cookies: async () => ({
        get: (name: string) => (name === "session" && currentToken ? { name, value: currentToken } : undefined),
        set: (name: string, value: string, opts: Record<string, unknown>) => {
            lastSetCookie = { name, value, opts };
            if (name === "session") currentToken = value || undefined;
        },
    }),
    headers: async () => new Headers(requestHeaders),
});
stub("next/cache", { revalidatePath: () => {}, revalidateTag: () => {} });

// ---- 測試資料 ----
// 密碼 hash 用 legacy SHA-256（快）；登入測試另外用 bcrypt。
const sha = (p: string) => createHash("sha256").update(p).digest("hex");
type Ids = Record<string, string>;
const ids: Ids = {};
const HASH: Record<string, string> = {};

/* eslint-disable @typescript-eslint/no-explicit-any */
let prisma: any;
let session: any;
let admin: any;
let superAdmin: any;
let authActions: any;

async function actAs(key: string | null, tenantOverride?: string | null) {
    if (!key) {
        currentToken = undefined;
        return;
    }
    const u = await prisma.user.findUnique({ where: { id: ids[key] } });
    currentToken = session.signSession({
        userId: u.id,
        tenantId: tenantOverride !== undefined ? tenantOverride : u.tenantId,
        isSuperAdmin: u.isSuperAdmin,
        issuedAt: Date.now(),
        pwv: session.passwordFingerprint(u.password),
    });
}

before(async () => {
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
        stdio: "pipe",
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh",
        env: process.env,
    });
    prisma = (await import("@/lib/prisma")).default;
    session = await import("@/lib/session");
    admin = await import("@/app/actions/admin");
    superAdmin = await import("@/app/actions/super-admin");
    authActions = await import("@/app/actions/auth");

    for (const [code, name] of [["read", "讀取者"], ["write", "編輯者"], ["admin", "管理者"]]) {
        ids[`role_${code}`] = (await prisma.role.create({ data: { code, name } })).id;
    }
    ids.tenantA = (await prisma.tenant.create({ data: { name: "甲企業", code: "tenant-a" } })).id;
    ids.tenantB = (await prisma.tenant.create({ data: { name: "乙企業", code: "tenant-b" } })).id;

    const mk = async (key: string, username: string, tenantId: string | null, role: string | null, extra: object = {}) => {
        HASH[key] = sha(`pw-${key}-12345`);
        const u = await prisma.user.create({
            data: {
                username,
                password: HASH[key],
                tenantId,
                realName: `${username}測試`,
                ...extra,
                ...(role ? { roles: { create: { roleId: ids[`role_${role}`] } } } : {}),
            },
        });
        ids[key] = u.id;
    };
    await mk("adminA", "adminA", ids.tenantA, "admin");
    await mk("writeA", "writeA", ids.tenantA, "write");
    await mk("readA", "readA", ids.tenantA, "read");
    await mk("adminB", "adminB", ids.tenantB, "admin");
    await mk("super", "superboss", null, null, { isSuperAdmin: true });

    ids.deptA = (await prisma.department.create({ data: { name: "甲部門", tenantId: ids.tenantA } })).id;
    ids.deptB = (await prisma.department.create({ data: { name: "乙部門", tenantId: ids.tenantB } })).id;
    ids.regionA = (await prisma.region.create({ data: { name: "甲區", tenantId: ids.tenantA } })).id;
    ids.locA = (await prisma.location.create({ data: { name: "甲場所", tenantId: ids.tenantA, regionId: ids.regionA } })).id;
    ids.dictA = (await prisma.dictionary.create({ data: { category: "c", label: "l", value: "v", tenantId: ids.tenantA } })).id;
});

after(async () => {
    try { await prisma?.$disconnect(); } catch { /* ignore */ }
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
});

const form = (o: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(o)) (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
    return fd;
};

// ---- 1. 所有 export 都必須在清單內：新增 server action 時這裡會失敗，逼你補授權測試 ----
const ADMIN_EXPORTS = [
    "getDepartments", "createDepartment", "deleteDepartment",
    "getUsers", "createUser", "toggleUserStatus", "deleteUser", "updateUserRole",
    "getRoles", "syncDefaultRoles",
    "getDictionary", "createDictionaryItem", "deleteDictionaryItem",
    "getOperationLogs",
    "getRegions", "createRegion", "toggleRegionStatus", "deleteRegion",
    "createLocation", "toggleLocationStatus",
    "getPermissions", "createPermission",
];
const SUPER_EXPORTS = [
    "getTenants", "getTenantById", "createTenant", "updateTenant", "toggleTenantStatus", "resetUserPassword", "getSuperAdminStats",
];

test("admin.ts / super-admin.ts 的 export 清單固定（ensureDefaultRoles 不得再被 export）", () => {
    assert.deepEqual(Object.keys(admin).sort(), [...ADMIN_EXPORTS].sort());
    assert.deepEqual(Object.keys(superAdmin).sort(), [...SUPER_EXPORTS].sort());
    assert.equal("ensureDefaultRoles" in admin, false);
});

// 每個 action 的呼叫方式：getter 預期回 []（或 null），寫入預期 { success:false }
type Call = { name: string; run: () => Promise<any>; kind: "getter" | "write" };
const adminCalls = (): Call[] => [
    { name: "getDepartments", kind: "getter", run: () => admin.getDepartments() },
    { name: "createDepartment", kind: "write", run: () => admin.createDepartment(form({ name: "X", parentId: "root" })) },
    { name: "deleteDepartment", kind: "write", run: () => admin.deleteDepartment(ids.deptA) },
    { name: "getUsers", kind: "getter", run: () => admin.getUsers() },
    { name: "createUser", kind: "write", run: () => admin.createUser(form({ username: "newguy", password: "password123", roles: [ids.role_read] })) },
    { name: "toggleUserStatus", kind: "write", run: () => admin.toggleUserStatus(ids.readA, false) },
    { name: "deleteUser", kind: "write", run: () => admin.deleteUser(ids.readA) },
    { name: "updateUserRole", kind: "write", run: () => admin.updateUserRole(ids.readA, ids.role_admin) },
    { name: "getRoles", kind: "getter", run: () => admin.getRoles() },
    { name: "syncDefaultRoles", kind: "write", run: () => admin.syncDefaultRoles() },
    { name: "getDictionary", kind: "getter", run: () => admin.getDictionary() },
    { name: "createDictionaryItem", kind: "write", run: () => admin.createDictionaryItem(form({ category: "c", label: "l", value: "v" })) },
    { name: "deleteDictionaryItem", kind: "write", run: () => admin.deleteDictionaryItem(ids.dictA) },
    { name: "getOperationLogs", kind: "getter", run: () => admin.getOperationLogs() },
    { name: "getRegions", kind: "getter", run: () => admin.getRegions() },
    { name: "createRegion", kind: "write", run: () => admin.createRegion(form({ name: "新區" })) },
    { name: "toggleRegionStatus", kind: "write", run: () => admin.toggleRegionStatus(ids.regionA, false) },
    { name: "deleteRegion", kind: "write", run: () => admin.deleteRegion(ids.regionA) },
    { name: "createLocation", kind: "write", run: () => admin.createLocation(form({ name: "新場所", regionId: ids.regionA })) },
    { name: "toggleLocationStatus", kind: "write", run: () => admin.toggleLocationStatus(ids.locA, false) },
    { name: "getPermissions", kind: "getter", run: () => admin.getPermissions() },
    { name: "createPermission", kind: "write", run: () => admin.createPermission(form({ name: "n", code: "x:y", type: "MENU", parentId: "root" })) },
];
const superCalls = (): Call[] => [
    { name: "getTenants", kind: "getter", run: () => superAdmin.getTenants() },
    { name: "getTenantById", kind: "getter", run: () => superAdmin.getTenantById(ids.tenantA) },
    { name: "createTenant", kind: "write", run: () => superAdmin.createTenant(form({ name: "丙", code: "tenant-c", adminUsername: "adminC", adminPassword: "password123" })) },
    { name: "updateTenant", kind: "write", run: () => superAdmin.updateTenant(ids.tenantA, form({ name: "改名" })) },
    { name: "toggleTenantStatus", kind: "write", run: () => superAdmin.toggleTenantStatus(ids.tenantA, false) },
    { name: "resetUserPassword", kind: "write", run: () => superAdmin.resetUserPassword(ids.readA, "newpassword123") },
    { name: "getSuperAdminStats", kind: "getter", run: () => superAdmin.getSuperAdminStats() },
];

function assertRejected(c: Call, res: any, who: string) {
    if (c.kind === "getter") {
        assert.ok(res === null || (Array.isArray(res) && res.length === 0), `${c.name} 對 ${who} 不得回傳資料`);
    } else {
        assert.equal(res?.success, false, `${c.name} 對 ${who} 必須被拒絕`);
    }
}

for (const who of [null, "readA", "writeA"] as const) {
    test(`admin actions：${who ?? "未登入"} 全部被拒`, async () => {
        await actAs(who);
        for (const c of adminCalls()) assertRejected(c, await c.run(), who ?? "未登入");
    });
}

test("admin actions：別的租戶 admin 對甲企業的資源無效（不得改到、不得讀到）", async () => {
    await actAs("adminB");
    const idTargets = ["deleteDepartment", "toggleUserStatus", "deleteUser", "updateUserRole", "deleteDictionaryItem", "toggleRegionStatus", "deleteRegion", "createLocation", "toggleLocationStatus"];
    for (const c of adminCalls().filter((x) => idTargets.includes(x.name))) {
        assertRejected(c, await c.run(), "別租戶 admin");
    }
    // 資料都還在
    assert.ok(await prisma.user.findUnique({ where: { id: ids.readA } }));
    assert.equal((await prisma.user.findUnique({ where: { id: ids.readA } })).status, true);
    assert.ok(await prisma.department.findUnique({ where: { id: ids.deptA } }));
    assert.ok(await prisma.region.findUnique({ where: { id: ids.regionA } }));
    // 讀取只看到自己租戶
    const users = await admin.getUsers();
    assert.ok(users.length >= 1 && users.every((u: any) => u.tenantId === ids.tenantB));
    assert.equal((await admin.getDepartments()).some((d: any) => d.id === ids.deptA), false);
    assert.equal((await admin.getRegions()).some((r: any) => r.id === ids.regionA), false);
});

for (const who of [null, "readA", "writeA", "adminA"] as const) {
    test(`super-admin actions：${who ?? "未登入"} 全部被拒`, async () => {
        await actAs(who);
        for (const c of superCalls()) assertRejected(c, await c.run(), who ?? "未登入");
        assert.equal((await prisma.tenant.findUnique({ where: { id: ids.tenantA } })).status, true);
        assert.equal(await prisma.tenant.count({ where: { code: "tenant-c" } }), 0);
    });
}

test("super admin 沒進企業：租戶級 admin 動作拒絕（沒有租戶 context）", async () => {
    await actAs("super", null);
    for (const c of adminCalls().filter((x) => x.kind === "write" && x.name !== "createPermission")) {
        assertRejected(c, await c.run(), "未進企業的 super admin");
    }
});

// ---- 2. 資料外洩 ----
test("getUsers / getOperationLogs 不帶 password hash", async () => {
    await actAs("adminA");
    await prisma.operationLog.create({ data: { userId: ids.adminA, action: "LOGIN", module: "SYSTEM", tenantId: ids.tenantA } });
    const users = await admin.getUsers();
    assert.ok(users.length >= 3);
    for (const u of users) assert.equal("password" in u, false);
    const logs = await admin.getOperationLogs();
    assert.ok(logs.length >= 1);
    for (const l of logs) if (l.user) assert.equal("password" in l.user, false);
});

test("getRoles 重複呼叫不改動既有角色（只補缺的）", async () => {
    await actAs("adminA");
    const before = await prisma.role.findMany({ orderBy: { code: "asc" } });
    await admin.getRoles();
    await admin.getRoles();
    const after = await prisma.role.findMany({ orderBy: { code: "asc" } });
    assert.deepEqual(after.map((r: any) => [r.id, r.name, r.updatedAt.getTime()]), before.map((r: any) => [r.id, r.name, r.updatedAt.getTime()]));
});

// ---- 3. createUser 驗證 ----
test("createUser：密碼少於 8 字、空密碼、假的 roleId、別租戶部門、重複帳號（跨租戶、不分大小寫）都被拒", async () => {
    await actAs("adminA");
    const base = { username: "freshuser", password: "password123", roles: [ids.role_read] };
    assert.equal((await admin.createUser(form({ ...base, password: "short12" }))).success, false);
    assert.equal((await admin.createUser(form({ ...base, password: "" }))).success, false);
    assert.equal((await admin.createUser(form({ ...base, roles: ["not-a-role"] }))).success, false);
    assert.equal((await admin.createUser(form({ ...base, departmentId: ids.deptB }))).success, false);
    assert.equal((await admin.createUser(form({ ...base, username: "ADMINB" }))).success, false, "別租戶已有 adminB");
    assert.equal((await admin.createUser(form({ ...base, username: "adminA" }))).success, false);
    assert.equal(await prisma.user.count({ where: { username: "freshuser" } }), 0);

    const ok = await admin.createUser(form({ ...base, departmentId: ids.deptA }));
    assert.equal(ok.success, true);
    const created = await prisma.user.findFirst({ where: { username: "freshuser" } });
    assert.equal(created.tenantId, ids.tenantA);
    assert.ok(created.password.startsWith("$2"), "新密碼存 bcrypt");
});

// ---- 4. 自己 / 最後一位管理者 ----
test("不能停用、刪除、降級自己", async () => {
    await actAs("adminA");
    assert.equal((await admin.toggleUserStatus(ids.adminA, false)).success, false);
    assert.equal((await admin.deleteUser(ids.adminA)).success, false);
    assert.equal((await admin.updateUserRole(ids.adminA, ids.role_read)).success, false);
    const u = await prisma.user.findUnique({ where: { id: ids.adminA }, include: { roles: { include: { role: true } } } });
    assert.equal(u.status, true);
    assert.equal(u.roles[0].role.code, "admin");
});

test("不能動到租戶最後一位啟用中的管理者（即使操作者不是他自己）", async () => {
    // super admin 進入甲企業 → 角色等同 admin，但不是甲企業的任何一位使用者
    await actAs("super", ids.tenantA);
    assert.equal((await admin.toggleUserStatus(ids.adminA, false)).success, false);
    assert.equal((await admin.deleteUser(ids.adminA)).success, false);
    assert.equal((await admin.updateUserRole(ids.adminA, ids.role_write)).success, false);
    assert.equal(await prisma.user.count({ where: { id: ids.adminA, status: true } }), 1);

    // 有第二位管理者之後就可以停用其中一位
    await prisma.userRole.create({ data: { userId: ids.writeA, roleId: ids.role_admin } });
    const r = await admin.toggleUserStatus(ids.adminA, false);
    assert.equal(r.success, true);
    await prisma.user.update({ where: { id: ids.adminA }, data: { status: true } });
    await prisma.userRole.deleteMany({ where: { userId: ids.writeA, roleId: ids.role_admin } });
});

// ---- 5. Permission 是全域資料 ----
test("createPermission：租戶 admin 被拒，super admin 可建立", async () => {
    await actAs("adminA");
    assert.equal((await admin.createPermission(form({ name: "n", code: "t:one", type: "MENU", parentId: "root" }))).success, false);
    assert.equal(await prisma.permission.count({ where: { code: "t:one" } }), 0);
    await actAs("super", ids.tenantA);
    assert.equal((await admin.createPermission(form({ name: "n", code: "t:one", type: "MENU", parentId: "root" }))).success, true);
});

// ---- 6. super admin：建立企業 / 重設密碼 ----
test("createTenant：弱密碼、跨租戶同名（不分大小寫）被拒；合法則建立", async () => {
    await actAs("super", null);
    const f = (o: object) => form({ name: "丙企業", code: "tenant-c", adminUsername: "adminC", adminPassword: "password123", ...o } as any);
    assert.equal((await superAdmin.createTenant(f({ adminPassword: "1234567" }))).success, false);
    assert.equal((await superAdmin.createTenant(f({ adminUsername: "ADMINA" }))).success, false);
    assert.equal(await prisma.tenant.count({ where: { code: "tenant-c" } }), 0);
    assert.equal((await superAdmin.createTenant(f({}))).success, true);
    assert.equal(await prisma.user.count({ where: { username: "adminC" } }), 1);
});

test("resetUserPassword：少於 8 字被拒；成功後該使用者舊 session 立即失效", async () => {
    const { getCurrentUser } = await import("@/lib/auth");
    await actAs("readA");
    assert.equal((await getCurrentUser())?.username, "readA");
    const oldToken = currentToken;

    await actAs("super", null);
    assert.equal((await superAdmin.resetUserPassword(ids.readA, "short")).success, false);
    assert.equal((await superAdmin.resetUserPassword(ids.readA, "brand-new-pass-1")).success, true);

    currentToken = oldToken;
    assert.equal(await getCurrentUser(), null, "密碼重設後舊 session 必須失效");

    await actAs("readA"); // 用新密碼指紋重簽的 session 有效
    assert.equal((await getCurrentUser())?.username, "readA");
});

test("沒有密碼指紋的舊格式 session 被視為無效", async () => {
    const { getCurrentUser } = await import("@/lib/auth");
    currentToken = session.signSession({ userId: ids.writeA, tenantId: ids.tenantA, isSuperAdmin: false, issuedAt: Date.now() });
    assert.equal(await getCurrentUser(), null);
});

test("logout 在伺服器端撤銷：同一個 token 登出後不能再用", async () => {
    const { getCurrentUser } = await import("@/lib/auth");
    await actAs("writeA");
    const token = currentToken;
    assert.equal((await getCurrentUser())?.username, "writeA");
    await authActions.logout();
    assert.equal(currentToken, undefined, "cookie 已清除");
    currentToken = token; // 攻擊者重放舊 token
    assert.equal(await getCurrentUser(), null);
    await new Promise((r) => setTimeout(r, 5));
    await actAs("writeA"); // 之後重新登入簽的新 token 有效
    assert.equal((await getCurrentUser())?.username, "writeA");
});

// ---- 7. 登入 ----
test("login：錯誤密碼寫 FAIL log（含 IP、不含密碼）；同 IP 第 6 次被鎖；別的 IP 與正確登入不受影響", async () => {
    const { _resetLoginLimiterForTest } = await import("@/lib/login-limiter");
    _resetLoginLimiterForTest();
    currentToken = undefined;
    const secret = "totally-wrong-password";
    requestHeaders = { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" };
    for (let i = 0; i < 5; i++) {
        const r = await authActions.login(form({ username: "writeA", password: secret }));
        assert.equal(r.success, false);
        assert.equal(r.message, "帳號或密碼錯誤");
    }
    const locked = await authActions.login(form({ username: "writeA", password: secret }));
    assert.equal(locked.success, false);
    assert.match(locked.message, /登入嘗試過多/);
    // 即使此時帶對密碼，同 IP 同帳號仍被鎖
    assert.equal((await authActions.login(form({ username: "writeA", password: "brand-new-pass-1" }))).success, false);

    const logs = await prisma.operationLog.findMany({ where: { action: "LOGIN", status: "FAIL", target: "writeA" } });
    assert.ok(logs.length >= 6, "失敗與鎖定都要記錄");
    assert.ok(logs.every((l: any) => l.ip === "203.0.113.7"));
    assert.ok(logs.every((l: any) => !(l.details ?? "").includes(secret)));

    // 另一個 IP 不受影響（密碼是 readA 被重設前的 writeA 原密碼 pw-writeA-12345，legacy hash 可驗）
    requestHeaders = { "cf-connecting-ip": "198.51.100.9" };
    const ok = await authActions.login(form({ username: "writeA", password: "pw-writeA-12345" }));
    assert.equal(ok.success, true);
    assert.equal(lastSetCookie?.name, "session");
    const payload = session.verifySession(lastSetCookie?.value);
    assert.equal(payload?.userId, ids.writeA);
    assert.ok(payload?.pwv, "session 帶密碼指紋");
    // legacy SHA-256 登入後被升級成 bcrypt，且 session 指紋對應新 hash
    const upgraded = await prisma.user.findUnique({ where: { id: ids.writeA } });
    assert.ok(upgraded.password.startsWith("$2"));
    assert.equal(payload?.pwv, session.passwordFingerprint(upgraded.password));
});

test("login：不存在的帳號回應與密碼錯誤相同，且也有記錄", async () => {
    const { _resetLoginLimiterForTest } = await import("@/lib/login-limiter");
    _resetLoginLimiterForTest();
    requestHeaders = { "cf-connecting-ip": "192.0.2.55" };
    const t0 = Date.now();
    const r = await authActions.login(form({ username: "ghost-user", password: "whatever-pass" }));
    assert.equal(r.success, false);
    assert.equal(r.message, "帳號或密碼錯誤");
    assert.ok(Date.now() - t0 >= 500, "失敗回應有最小延遲");
    assert.equal(await prisma.operationLog.count({ where: { action: "LOGIN", status: "FAIL", target: "ghost-user", ip: "192.0.2.55" } }), 1);
});
