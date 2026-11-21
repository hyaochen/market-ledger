// 已知裝置 cookie：登入成功後發給瀏覽器，內容是簽章過的 { userId, pwv, issuedAt }。
// 用途：帳號層（跨 IP 累計 50 次）鎖定時，持有效 cookie 的裝置仍可繼續登入，
// 避免攻擊者用多個 IP 就能把老闆 / 媽媽一直鎖在門外。
// 簽章金鑰由 SESSION_SECRET 衍生但與 session 分開用途（見 session.ts signForPurpose）；
// pwv 是密碼指紋，改密碼後舊 cookie 自動失效。
import { timingSafeEqual } from "crypto";
import { signForPurpose } from "./session";

export const KNOWN_DEVICE_COOKIE = "kd";
export const KNOWN_DEVICE_MAX_AGE_SEC = 180 * 24 * 60 * 60;
const MAX_AGE_MS = KNOWN_DEVICE_MAX_AGE_SEC * 1000;
const PURPOSE = "known-device-v1";
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type KnownDevicePayload = { userId: string; pwv: string; issuedAt: number };

function sig(payloadB64: string): Buffer {
    return signForPurpose(PURPOSE, payloadB64);
}

export function signKnownDevice(payload: KnownDevicePayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${payloadB64}.${sig(payloadB64).toString("base64url")}`;
}

/** 驗證 cookie 是否屬於這個 user、且密碼指紋仍相符、且未過期。 */
export function verifyKnownDevice(
    token: string | null | undefined,
    expected: { userId: string; pwv: string },
    now: number = Date.now(),
): boolean {
    if (!token || !expected.userId || !expected.pwv) return false;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    const actual = Buffer.from(parts[1], "base64url");
    const want = sig(parts[0]);
    if (actual.length !== want.length || !timingSafeEqual(actual, want)) return false;
    try {
        const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8")) as Partial<KnownDevicePayload>;
        if (typeof p.userId !== "string" || typeof p.pwv !== "string" || typeof p.issuedAt !== "number") return false;
        if (p.userId !== expected.userId) return false;
        const a = Buffer.from(p.pwv);
        const b = Buffer.from(expected.pwv);
        if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
        if (p.issuedAt > now + FUTURE_SKEW_MS) return false;
        if (now - p.issuedAt > MAX_AGE_MS) return false;
        return true;
    } catch {
        return false;
    }
}
