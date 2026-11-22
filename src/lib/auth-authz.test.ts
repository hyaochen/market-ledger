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
let knownDeviceCookie: string | undefined;

function stub(id: string, exports: Record<string, unknown>) {
    const resolved = require.resolve(id);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as unknown as NodeJS.Module;
}
stub("next/headers", {
    cookies: async () => ({
        get: (name: string) => {
            if (name === "kd" && knownDeviceCookie) return { name, value: knownDeviceCookie };
            return name === "session" && currentToken ? { name, value: currentToken } : undefined;
        },
        set: (name: string, value: string, opts: Record<string, unknown>) => {
            if (name === "kd") knownDeviceCookie = value || undefined;
            lastSetCookie = { name, value, opts };
            if (name === "session") currentToken = value || undefined;
        },
    }),
    headers: async () => new Headers(requestHeaders),
});
stub("next/cache", { revalidatePath: () => {}, revalidateTag: () => {} });

// 節流器一定要拿「server action 實際在用的那一個 module 實例」。
// Node 20 + tsx 下，action 內部載入的實例和測試自己用 import() 載入的不是同一個
// （本機 Node 24 是同一個，所以只在 CI 與容器的 Node 20 才會壞）：用 import() 重設或預先
// 灌次數會打到另一個實例，action 看到的仍是空的。require 走的是 action 用的那份快取。
function limiter(): typeof import("@/lib/login-limiter") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@/lib/login-limiter");
}

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
    const { _resetLoginLimiterForTest } = limiter();
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

    const fails = await prisma.operationLog.findMany({ where: { action: "LOGIN", status: "FAIL", target: "writeA" } });
    assert.ok(fails.length >= 5, "每次密碼錯誤都要記錄");
    const lockedLogs = await prisma.operationLog.findMany({ where: { action: "LOGIN", status: "LOCKED", ip: "203.0.113.7" } });
    assert.ok(lockedLogs.length >= 1, "鎖定要用 LOCKED 狀態記錄");
    const logs = [...fails, ...lockedLogs];
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

test("login：帳號層被鎖時，已知裝置 cookie 可通過（仍受 IP+帳號層限制）；沒有或別人的 cookie 仍被擋", async () => {
    const { _resetLoginLimiterForTest, reserveLoginAttempt, MAX_ATTEMPTS_PER_IP_USER } = limiter();
    const { signKnownDevice } = await import("@/lib/known-device");
    _resetLoginLimiterForTest();
    currentToken = undefined;
    const writeA = await prisma.user.findUnique({ where: { id: ids.writeA } });
    const readA = await prisma.user.findUnique({ where: { id: ids.readA } });
    // 攻擊者用 10 個 IP 把 writeA 的帳號層打滿
    for (let ip = 1; ip <= 10; ip++) {
        for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) reserveLoginAttempt(`10.1.0.${ip}`, "writeA");
    }
    requestHeaders = { "cf-connecting-ip": "2001:db8:aa:bb::1" };

    knownDeviceCookie = undefined;
    const noKd = await authActions.login(form({ username: "writeA", password: "pw-writeA-12345" }));
    assert.equal(noKd.success, false);
    assert.match(String((noKd as { message?: string }).message), /登入嘗試過多/);

    knownDeviceCookie = signKnownDevice({ userId: readA.id, pwv: session.passwordFingerprint(readA.password), issuedAt: Date.now() });
    const otherKd = await authActions.login(form({ username: "writeA", password: "pw-writeA-12345" }));
    assert.equal(otherKd.success, false, "別人的已知裝置 cookie 不能通過");

    knownDeviceCookie = signKnownDevice({ userId: writeA.id, pwv: session.passwordFingerprint(writeA.password), issuedAt: Date.now() });
    const withKd = await authActions.login(form({ username: "writeA", password: "pw-writeA-12345" }));
    assert.equal(withKd.success, true);

    // 已知裝置路徑仍受 IP+帳號層限制：同一個 /64 的另一個位址連續猜錯 5 次後被鎖
    requestHeaders = { "cf-connecting-ip": "2001:db8:cc:dd::1" };
    knownDeviceCookie = signKnownDevice({ userId: writeA.id, pwv: session.passwordFingerprint(writeA.password), issuedAt: Date.now() });
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP_USER; i++) {
        requestHeaders = { "cf-connecting-ip": `2001:db8:cc:dd::${i + 10}` };
        const bad = await authActions.login(form({ username: "writeA", password: "錯誤的密碼" }));
        assert.match(String((bad as { message?: string }).message), /帳號或密碼錯誤/);
    }
    requestHeaders = { "cf-connecting-ip": "2001:db8:cc:dd:9:9:9:9" };
    const locked = await authActions.login(form({ username: "writeA", password: "pw-writeA-12345" }));
    assert.equal(locked.success, false);
    assert.match(String((locked as { message?: string }).message), /登入嘗試過多/);
    knownDeviceCookie = undefined;
});

test("login：不存在的帳號回應與密碼錯誤相同，且也有記錄", async () => {
    const { _resetLoginLimiterForTest } = limiter();
    _resetLoginLimiterForTest();
    requestHeaders = { "cf-connecting-ip": "192.0.2.55" };
    const t0 = Date.now();
    const r = await authActions.login(form({ username: "ghost-user", password: "whatever-pass" }));
    assert.equal(r.success, false);
    assert.equal(r.message, "帳號或密碼錯誤");
    assert.ok(Date.now() - t0 >= 500, "失敗回應有最小延遲");
    assert.equal(await prisma.operationLog.count({ where: { action: "LOGIN", status: "FAIL", target: "(unknown user)", ip: "192.0.2.55" } }), 1);
    // 不存在的帳號不記原字串（可能是打錯欄位的密碼）
    assert.equal(await prisma.operationLog.count({ where: { target: "ghost-user" } }), 0);
});

// ---- 7. 特權操作稽核（OperationLog） ----
// 用自己新建的租戶與使用者，不動前面測試依賴的狀態。
const PRIV_MODULES = ["USER", "TENANT", "AUTH"];
const privLogs = async () => {
    const rows = await prisma.operationLog.findMany({ where: { module: { in: PRIV_MODULES } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map((r: any) => ({ ...r, d: r.details ? JSON.parse(r.details) : null }));
};
const privCount = async () => (await privLogs()).length;
const lastPriv = async () => {
    const all = await privLogs();
    return all[all.length - 1];
};
const AUDIT_IP = "198.51.100.9";

test("稽核：租戶 admin 的帳號操作各留一筆紀錄（欄位、tenantId、IP 正確）；被擋與驗證失敗不留", async () => {
    requestHeaders = { "cf-connecting-ip": AUDIT_IP };
    ids.auditT = (await prisma.tenant.create({ data: { name: "稽核企業", code: "audit-co" } })).id;
    ids.auditDept = (await prisma.department.create({ data: { name: "稽核部門", tenantId: ids.auditT } })).id;
    HASH.auditAdmin = sha("pw-auditAdmin-12345");
    ids.auditAdmin = (await prisma.user.create({
        data: { username: "auditAdmin", password: HASH.auditAdmin, tenantId: ids.auditT, realName: "稽核管理員", roles: { create: { roleId: ids.role_admin } } },
    })).id;

    // 沒有權限 / 驗證失敗：不留紀錄
    const n0 = await privCount();
    await actAs("readA");
    assert.equal((await admin.createUser(form({ username: "nobody", password: "password123", roles: [ids.role_read] }))).success, false);
    await actAs("adminB");
    assert.equal((await admin.toggleUserStatus(ids.auditAdmin, false)).success, false);
    await actAs("auditAdmin");
    assert.equal((await admin.createUser(form({ username: "auditNew", password: "short", roles: [ids.role_read] }))).success, false);
    assert.equal(await privCount(), n0, "被擋下與驗證失敗不得留下紀錄");

    // createUser
    const r1 = await admin.createUser(form({ username: "auditNew", realName: "稽核新人", password: "password123", departmentId: ids.auditDept, roles: [ids.role_read] }));
    assert.equal(r1.success, true);
    const created = await prisma.user.findFirst({ where: { username: "auditNew" } });
    assert.equal(await privCount(), n0 + 1);
    let l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.status, l.ip], ["CREATE", "USER", "auditNew", "SUCCESS", AUDIT_IP]);
    assert.equal(l.userId, ids.auditAdmin);
    assert.equal(l.tenantId, ids.auditT);
    assert.deepEqual(l.d, {
        op: "user.create",
        userId: created.id,
        before: null,
        after: { username: "auditNew", realName: "稽核新人", departmentId: ids.auditDept, roleCodes: ["read"], status: true },
    });
    assert.doesNotMatch(l.details, /password123/);
    assert.equal(l.details.includes(created.password), false);

    // toggleUserStatus
    assert.equal((await admin.toggleUserStatus(created.id, false)).success, true);
    l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.tenantId], ["UPDATE", "USER", "auditNew", ids.auditT]);
    assert.deepEqual(l.d, { op: "user.status", userId: created.id, before: { status: true }, after: { status: false } });
    assert.equal(await privCount(), n0 + 2);

    // updateUserRole
    assert.equal((await admin.updateUserRole(created.id, ids.role_write)).success, true);
    l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.tenantId], ["UPDATE", "USER", "auditNew", ids.auditT]);
    assert.deepEqual(l.d, { op: "user.role", userId: created.id, before: { roleCodes: ["read"] }, after: { roleCodes: ["write"] } });
    assert.equal(await privCount(), n0 + 3);

    // 失敗的操作（最後一位管理者不能降級）不留紀錄
    assert.equal((await admin.updateUserRole(ids.auditAdmin, ids.role_read)).success, false);
    assert.equal(await privCount(), n0 + 3);
    ids.auditNew = created.id;
});

test("deleteUser 的實際行為：有角色刪不掉（外鍵擋下、不留紀錄）；沒角色才刪得掉，記帳紀錄不擋（userId 變 null）；成功才寫紀錄", async () => {
    await actAs("auditAdmin");
    const n0 = await privCount();

    // 1. 有 UserRole 的使用者：刪除失敗（UserRole.userId 沒有 onDelete，預設 Restrict）
    const rolesBefore = await prisma.userRole.count({ where: { userId: ids.auditNew } });
    assert.equal(rolesBefore, 1);
    const fail = await admin.deleteUser(ids.auditNew);
    assert.deepEqual(fail, { success: false, error: "刪除失敗" });
    assert.ok(await prisma.user.findUnique({ where: { id: ids.auditNew } }), "使用者還在");
    assert.equal(await privCount(), n0, "失敗不留紀錄");

    // 2. 沒角色、有記帳紀錄：Entry.userId 是可空的關聯（預設 SetNull）：刪得掉，Entry 保留
    await prisma.userRole.deleteMany({ where: { userId: ids.auditNew } });
    const entry = await prisma.entry.create({
        data: { date: new Date(), type: "EXPENSE", totalPrice: 100, note: "稽核測試支出", userId: ids.auditNew, tenantId: ids.auditT },
    });
    const ok = await admin.deleteUser(ids.auditNew);
    assert.equal(ok.success, true);
    assert.equal(await prisma.user.findUnique({ where: { id: ids.auditNew } }), null);
    const keptEntry = await prisma.entry.findUnique({ where: { id: entry.id } });
    assert.ok(keptEntry && keptEntry.userId === null, "記帳紀錄保留，userId 變 null");

    assert.equal(await privCount(), n0 + 1);
    const l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.userId, l.tenantId, l.ip], ["DELETE", "USER", "auditNew", ids.auditAdmin, ids.auditT, AUDIT_IP]);
    assert.deepEqual(l.d, { op: "user.delete", userId: ids.auditNew, before: { username: "auditNew", roleCodes: [], status: false }, after: null });
});

test("稽核：super admin 的企業操作與重設密碼（紀錄歸在被操作的企業；不含密碼與雜湊）", async () => {
    const pw = "ZzSecretPw-98765";
    const n0 = await privCount();

    // 被擋：租戶 admin 呼叫不留紀錄
    await actAs("auditAdmin");
    assert.equal((await superAdmin.toggleTenantStatus(ids.auditT, false)).success, false);
    assert.equal((await superAdmin.resetUserPassword(ids.auditAdmin, "newpassword123")).success, false);
    assert.equal(await privCount(), n0);

    await actAs("super", null);
    // createTenant（交易內：企業、管理者、稽核一起）
    const created = await superAdmin.createTenant(form({ name: "丁企業", code: "audit-d", adminUsername: "auditDAdmin", adminPassword: pw, note: "測試備註" }));
    assert.equal(created.success, true);
    const tenantD = await prisma.tenant.findUnique({ where: { code: "audit-d" } });
    const adminD = await prisma.user.findFirst({ where: { username: "auditDAdmin" } });
    let l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.userId, l.tenantId, l.ip], ["CREATE", "TENANT", "audit-d", ids.super, tenantD.id, AUDIT_IP]);
    assert.deepEqual(l.d, {
        op: "tenant.create",
        tenantId: tenantD.id,
        before: null,
        after: { code: "audit-d", name: "丁企業", note: "測試備註", status: true },
        adminUserId: adminD.id,
        adminUsername: "auditDAdmin",
    });
    assert.equal(l.details.includes(pw), false);
    assert.equal(l.details.includes(adminD.password), false);

    // updateTenant
    assert.equal((await superAdmin.updateTenant(tenantD.id, form({ name: "丁企業改名", note: "" }))).success, true);
    l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.tenantId], ["UPDATE", "TENANT", "audit-d", tenantD.id]);
    assert.deepEqual(l.d, { op: "tenant.update", tenantId: tenantD.id, before: { name: "丁企業", note: "測試備註" }, after: { name: "丁企業改名", note: null } });

    // toggleTenantStatus（停用再啟用，各一筆）
    assert.equal((await superAdmin.toggleTenantStatus(tenantD.id, false)).success, true);
    l = await lastPriv();
    assert.deepEqual(l.d, { op: "tenant.status", tenantId: tenantD.id, tenantName: "丁企業改名", before: { status: true }, after: { status: false } });
    assert.equal((await superAdmin.toggleTenantStatus(tenantD.id, true)).success, true);
    assert.deepEqual((await lastPriv()).d.after, { status: true });
    assert.equal(await privCount(), n0 + 4);

    // 不存在的企業：操作失敗、不留紀錄
    assert.equal((await superAdmin.updateTenant("no-such-tenant", form({ name: "x" }))).success, false);
    assert.equal((await superAdmin.toggleTenantStatus("no-such-tenant", false)).success, false);
    assert.equal(await privCount(), n0 + 4);

    // resetUserPassword：tenantId 是被重設者所屬企業；details 不含密碼或雜湊（新舊都不含）
    const oldHash = (await prisma.user.findUnique({ where: { id: ids.auditAdmin } })).password;
    const newPw = "BrandNewPw-24680";
    const r = await superAdmin.resetUserPassword(ids.auditAdmin, newPw);
    assert.equal(r.success, true);
    const newHash = (await prisma.user.findUnique({ where: { id: ids.auditAdmin } })).password;
    assert.notEqual(newHash, oldHash);
    l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.userId, l.tenantId, l.ip], ["UPDATE", "USER", "auditAdmin", ids.super, ids.auditT, AUDIT_IP]);
    assert.deepEqual(l.d, { op: "user.password_reset", userId: ids.auditAdmin, sessionsRevoked: true });
    for (const secret of [newPw, oldHash, newHash, HASH.auditAdmin]) assert.equal(l.details.includes(secret), false);
    // 全部新紀錄整列（含所有欄位）都不能出現這些密碼與雜湊
    const dump = JSON.stringify((await privLogs()).slice(n0));
    for (const secret of [pw, newPw, oldHash, newHash, adminD.password]) assert.equal(dump.includes(secret), false);

    // 重設不存在的使用者：失敗、不留紀錄
    const n1 = await privCount();
    assert.equal((await superAdmin.resetUserPassword("no-such-user", "newpassword123")).success, false);
    assert.equal(await privCount(), n1);
    ids.auditD = tenantD.id;
});

test("稽核：switchToTenant / switchBackToSuperAdmin 記進入與離開的企業；失敗與重複離開不留紀錄", async () => {
    const n0 = await privCount();
    // 非 super admin 與不存在的企業
    await actAs("adminA");
    assert.equal((await authActions.switchToTenant(ids.auditT)).success, false);
    assert.equal((await authActions.switchBackToSuperAdmin()).success, false);
    await actAs("super", null);
    assert.equal((await authActions.switchToTenant("no-such-tenant")).success, false);
    assert.equal(await privCount(), n0);

    // 沒進任何企業就「離開」：沒有東西可記
    assert.equal((await authActions.switchBackToSuperAdmin()).success, true);
    assert.equal(await privCount(), n0);

    // 進入（action 自己換 session cookie，後面的離開沿用）
    assert.equal((await authActions.switchToTenant(ids.auditT)).success, true);
    let l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.userId, l.tenantId, l.ip], ["SWITCH", "AUTH", "audit-co", ids.super, ids.auditT, AUDIT_IP]);
    assert.deepEqual(l.d, { op: "tenant.switch_in", tenantId: ids.auditT, tenantName: "稽核企業" });

    // 離開：tenantId 是離開前所在的企業
    assert.equal((await authActions.switchBackToSuperAdmin()).success, true);
    l = await lastPriv();
    assert.deepEqual([l.action, l.module, l.target, l.userId, l.tenantId], ["SWITCH", "AUTH", "audit-co", ids.super, ids.auditT]);
    assert.deepEqual(l.d, { op: "tenant.switch_back", tenantId: ids.auditT, tenantName: "稽核企業" });
    assert.equal(await privCount(), n0 + 2);
});

test("稽核：該企業的 admin 在操作紀錄看得到 super admin 對他們做的事", async () => {
    await actAs("auditAdmin");
    const logs = await admin.getOperationLogs();
    const ops = logs.filter((x: any) => x.module !== "SYSTEM").map((x: any) => JSON.parse(x.details).op);
    for (const op of ["user.create", "user.status", "user.role", "user.delete", "user.password_reset", "tenant.switch_in", "tenant.switch_back"]) {
        assert.ok(ops.includes(op), `${op} 應出現在 auditAdmin 的操作紀錄`);
    }
    const reset = logs.find((x: any) => x.details && JSON.parse(x.details).op === "user.password_reset");
    assert.equal(reset.user.username, "superboss");
    assert.equal("password" in reset.user, false);
    // 別企業的操作（丁企業建立）不會出現在這裡
    assert.equal(logs.some((x: any) => x.target === "audit-d"), false);
    assert.ok(logs.every((x: any) => x.tenantId === ids.auditT));
});

test("稽核寫入失敗：交易內的操作整個回滾、事後寫入的操作不回滾（只留一行 console.error，不含敏感值）", async () => {
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
    try {
        // 用 SQLite trigger 讓特定 target 的稽核寫入一定失敗
        await prisma.$executeRawUnsafe("CREATE TRIGGER audit_boom BEFORE INSERT ON OperationLog WHEN NEW.target IN ('boomuser', 'boom-co') BEGIN SELECT RAISE(ABORT, 'audit down'); END");
        const boom = await prisma.user.create({
            data: { username: "boomuser", password: sha("pw-boom-12345"), tenantId: ids.auditT, realName: "爆炸測試", roles: { create: { roleId: ids.role_read } } },
        });
        const boomTenant = await prisma.tenant.create({ data: { name: "爆炸企業", code: "boom-co" } });
        const n0 = await privCount();

        // 交易內：updateUserRole 回滾
        await actAs("auditAdmin");
        const rr = await admin.updateUserRole(boom.id, ids.role_write);
        assert.equal(rr.success, false);
        const roles = await prisma.userRole.findMany({ where: { userId: boom.id }, include: { role: true } });
        assert.deepEqual(roles.map((x: any) => x.role.code), ["read"], "角色變更必須回滾");

        // 交易內：updateTenant 回滾
        await actAs("super", null);
        assert.equal((await superAdmin.updateTenant(boomTenant.id, form({ name: "改了" }))).success, false);
        assert.equal((await prisma.tenant.findUnique({ where: { id: boomTenant.id } })).name, "爆炸企業");

        // 事後寫入：toggleUserStatus 成功，只有一行 console.error
        await actAs("auditAdmin");
        errors.length = 0;
        assert.equal((await admin.toggleUserStatus(boom.id, false)).success, true);
        assert.equal((await prisma.user.findUnique({ where: { id: boom.id } })).status, false);
        assert.equal(await privCount(), n0, "稽核沒寫進去");
        assert.equal(errors.filter((e) => e.includes("[audit]")).length, 1);
        for (const e of errors) assert.equal(/boomuser|爆炸|password|\$2/i.test(e), false, "console.error 不含帳號或敏感值");
    } finally {
        console.error = origError;
        await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS audit_boom");
    }
});
