'use server';

import { cookies, headers } from "next/headers";
import prisma from "@/lib/prisma";
import { signSession, passwordFingerprint, verifySession } from "@/lib/session";
import { getCurrentUser, getSessionPayload, resolveRoleCode } from "@/lib/auth";
import { hashPasswordAsync, verifyPassword } from "@/lib/password";
import {
    clientIpFromHeaders,
    releaseLoginAttempt,
    reserveLoginAttempt,
    reserveTrustedAttempt,
    throttleKeyForIp,
} from "@/lib/login-limiter";
import { KNOWN_DEVICE_COOKIE, KNOWN_DEVICE_MAX_AGE_SEC, signKnownDevice, verifyKnownDevice } from "@/lib/known-device";
import { passwordGate } from "@/lib/bcrypt-gate";
import { revokeUserSessions } from "@/lib/session-revocation";

// 統一最小回應時間：失敗路徑（含帳號不存在、被鎖定）都補到這個時間，降低帳號列舉的 timing 差異。
// 帳號不存在時另外會跑一次 dummy bcrypt，所以不是只靠這個 padding。
const MIN_RESPONSE_MS = 600;
const MAX_USERNAME_LEN = 64;
const MAX_PASSWORD_LEN = 1024;
const BUSY_MESSAGE = "系統忙碌，請稍後再試";

// 帳號不存在時用來比對的 dummy hash（只算一次），讓「不存在」和「密碼錯」花一樣久的 bcrypt 時間
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash() {
    if (!dummyHashPromise) {
        dummyHashPromise = hashPasswordAsync(`dummy-${Math.random()}-${Date.now()}`);
    }
    return dummyHashPromise;
}

async function delayUntil(startedAt: number, minMs: number) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
    }
}

async function getClientIp(): Promise<string> {
    try {
        return clientIpFromHeaders(await headers());
    } catch {
        return "unknown";
    }
}

/** 失敗 / 被鎖定的登入嘗試寫入 OperationLog（不含密碼）。寫入失敗不影響登入流程。 */
async function logLoginEvent(args: {
    username: string;
    ip: string;
    status: "FAIL" | "LOCKED";
    reason: string;
    userId?: string | null;
    tenantId?: string | null;
}) {
    try {
        await prisma.operationLog.create({
            data: {
                userId: args.userId ?? null,
                action: "LOGIN",
                module: "SYSTEM",
                // 不存在的帳號不記原字串：使用者常把密碼打進帳號欄
                target: args.userId ? args.username.slice(0, MAX_USERNAME_LEN) : "(unknown user)",
                details: JSON.stringify({ reason: args.reason }),
                ip: args.ip,
                status: args.status,
                tenantId: args.tenantId ?? null,
            },
        });
    } catch (err) {
        console.error("[auth] failed to write login log:", err);
    }
}

/** 統一的 session cookie 寫入 / 清除。 */
async function setSessionCookie(
    payload: { userId: string; tenantId: string | null; isSuperAdmin: boolean; pwv?: string },
) {
    const token = signSession({ ...payload, issuedAt: Date.now() });
    const cookieStore = await cookies();
    cookieStore.set("session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });
}

async function clearSessionCookie() {
    const cookieStore = await cookies();
    cookieStore.set("session", "", {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
}

// 查詢用戶（跨租戶搜尋）。新增帳號已禁止跨租戶同名；若歷史資料仍有重複，固定取最早建立的，行為才是確定的。
function findLoginUser(username: string) {
    return prisma.user.findFirst({
        where: {
            username,
            status: true,
            OR: [
                { isSuperAdmin: true },
                { tenant: { status: true } },
            ],
        },
        orderBy: { createdAt: "asc" },
        include: { roles: { include: { role: true } }, tenant: true },
    });
}

async function setKnownDeviceCookie(userId: string, storedHash: string) {
    const token = signKnownDevice({ userId, pwv: passwordFingerprint(storedHash), issuedAt: Date.now() });
    const cookieStore = await cookies();
    cookieStore.set(KNOWN_DEVICE_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: KNOWN_DEVICE_MAX_AGE_SEC,
    });
}

export async function login(formData: FormData) {
    const t0 = Date.now();
    const username = (formData.get("username") as string | null)?.trim();
    const password = formData.get("password") as string | null;

    if (!username || !password) {
        return { success: false, message: "請輸入帳號與密碼" };
    }
    if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: "帳號或密碼錯誤" };
    }

    const ip = await getClientIp(); // 完整 IP：只用在 OperationLog
    const throttleIp = throttleKeyForIp(ip); // 節流 key：IPv6 收斂到 /64

    // 先預約（同步 +1）再做任何 await：同時湧入的請求不可能都看到 count = 0。帳號不存在也算，防列舉。
    const reserve = reserveLoginAttempt(throttleIp, username);
    let user: Awaited<ReturnType<typeof findLoginUser>> | undefined;
    let trusted = false;
    if (!reserve.allowed) {
        // 只有「帳號層」鎖定（IP+帳號、IP 層都還沒滿）才給已知裝置機會；其餘照舊鎖定。
        if (reserve.scope === "user") {
            user = await findLoginUser(username);
            if (user) {
                const kd = (await cookies()).get(KNOWN_DEVICE_COOKIE)?.value;
                if (verifyKnownDevice(kd, { userId: user.id, pwv: passwordFingerprint(user.password) })) {
                    // 同步檢查並累計 IP+帳號 / IP 層；之後照常驗密碼
                    const t = reserveTrustedAttempt(throttleIp, username);
                    if (t.allowed) trusted = true;
                    else {
                        if (t.shouldLog) {
                            await logLoginEvent({ username, ip, status: "LOCKED", reason: `locked:${t.scope}` });
                        }
                        await delayUntil(t0, MIN_RESPONSE_MS);
                        return { success: false, message: `登入嘗試過多，請 ${t.retryMinutes} 分鐘後再試` };
                    }
                }
            }
        }
        if (!trusted) {
            if (reserve.shouldLog) {
                await logLoginEvent({ username, ip, status: "LOCKED", reason: `locked:${reserve.scope}` });
            }
            await delayUntil(t0, MIN_RESPONSE_MS);
            return { success: false, message: `登入嘗試過多，請 ${reserve.retryMinutes} 分鐘後再試` };
        }
    }

    if (user === undefined) user = await findLoginUser(username);

    // 不論帳號是否存在都做一次 bcrypt 比對；全域併發閘門：太忙就直接拒絕（預約不退回）
    const gated = await passwordGate.run(async () =>
        verifyPassword(password, user ? user.password : await getDummyHash()),
    );
    if (gated.busy) {
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: BUSY_MESSAGE };
    }
    const check = gated.value;
    if (!user || !check.ok) {
        await logLoginEvent({
            username,
            ip,
            status: "FAIL",
            reason: user ? "bad-password" : "unknown-user",
            userId: user?.id,
            tenantId: user?.tenantId,
        });
        await delayUntil(t0, MIN_RESPONSE_MS);
        return { success: false, message: "帳號或密碼錯誤" };
    }

    // Lazy rehash：舊 SHA-256 驗證通過 → 升級為 bcrypt 存回
    let storedHash = user.password;
    if (check.needsRehash) {
        try {
            const upgraded = await hashPasswordAsync(password);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: upgraded },
            });
            storedHash = upgraded;
        } catch (err) {
            console.error('[auth] lazy rehash failed:', err);
        }
    }

    // 登入成功：還回預約
    releaseLoginAttempt(throttleIp, username, { skipUser: trusted });

    const roleCodes = user.roles.map((item) => item.role.code);
    const roleCode = resolveRoleCode(roleCodes);

    await setKnownDeviceCookie(user.id, storedHash);
    await setSessionCookie({
        userId: user.id,
        tenantId: user.tenantId,
        isSuperAdmin: user.isSuperAdmin,
        pwv: passwordFingerprint(storedHash),
    });

    // 記錄登入日誌
    await prisma.operationLog.create({
        data: {
            userId: user.id,
            action: 'LOGIN',
            module: 'SYSTEM',
            target: user.username,
            details: JSON.stringify({ isSuperAdmin: user.isSuperAdmin }),
            ip,
            status: 'SUCCESS',
            tenantId: user.tenantId,
        },
    });

    return {
        success: true,
        roleCode,
        isSuperAdmin: user.isSuperAdmin,
    };
}

/** 超級管理者切換到指定企業 */
export async function switchToTenant(tenantId: string) {
    const user = await getCurrentUser();
    const payload = await getSessionPayload();
    if (!user || !payload || !user.isSuperAdmin) {
        return { success: false, error: "權限不足" };
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
        return { success: false, error: "企業不存在" };
    }

    await setSessionCookie({ userId: user.id, tenantId: tenant.id, isSuperAdmin: true, pwv: payload.pwv });
    return { success: true };
}

/** 超級管理者返回超級管理後台 */
export async function switchBackToSuperAdmin() {
    const user = await getCurrentUser();
    const payload = await getSessionPayload();
    if (!user || !payload || !user.isSuperAdmin) {
        return { success: false, error: "權限不足" };
    }

    await setSessionCookie({ userId: user.id, tenantId: null, isSuperAdmin: true, pwv: payload.pwv });
    return { success: true };
}

export async function logout() {
    // 伺服器端撤銷：只信簽章正確的 cookie，記下時間點，之後 issuedAt 更早的 session 全部失效
    try {
        const cookieStore = await cookies();
        const payload = verifySession(cookieStore.get("session")?.value);
        if (payload?.userId) await revokeUserSessions(payload.userId);
    } catch (err) {
        console.error("[auth] session revoke on logout failed:", err);
    }
    await clearSessionCookie();
}
