import { createHmac, timingSafeEqual } from "crypto";

export type SessionPayload = {
    userId: string;
    tenantId: string | null;
    isSuperAdmin: boolean;
    issuedAt: number;
    // 密碼指紋：密碼一改，舊 session 就對不上（見 passwordFingerprint）
    pwv?: string;
};

const FALLBACK_SECRET = "dev-secret-should-be-changed";
const MIN_SECRET_LEN = 32;

let warnedInsecure = false;

// 每次呼叫都「現場」讀 env 並重新檢查，絕不把「檢查過了」當成旗標快取：
// 舊版先設 secretChecked = true 才 throw，第一次 throw 之後所有呼叫都會跳過檢查、
// 改用公開在 GitHub 的 fallback 常數簽章（fail-open）。
// build 階段（collect routes）NODE_ENV 已是 production 但 secret 尚未注入，故該階段跳過並用 fallback（只供 build，不處理請求）。
function getSecret(): string {
    const env = process.env.SESSION_SECRET;
    if (process.env.NEXT_PHASE === "phase-production-build") return env || FALLBACK_SECRET;
    if (process.env.NODE_ENV === "production") {
        if (!env) {
            throw new Error("SESSION_SECRET must be set in production (min 32 chars).");
        }
        if (env === FALLBACK_SECRET) {
            throw new Error("SESSION_SECRET must not be the built-in development default.");
        }
        if (env.length < MIN_SECRET_LEN) {
            throw new Error(`SESSION_SECRET too short (got ${env.length}, need ${MIN_SECRET_LEN}+).`);
        }
        return env;
    }
    if (!env || env === FALLBACK_SECRET) {
        if (!warnedInsecure) {
            warnedInsecure = true;
            console.warn("[session] Using insecure fallback SESSION_SECRET. Set SESSION_SECRET in .env for real security.");
        }
        return FALLBACK_SECRET;
    }
    return env;
}

function encodeBase64Url(input: string | Buffer) {
    return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string) {
    return Buffer.from(input, "base64url");
}

export function signSession(payload: SessionPayload) {
    const secret = getSecret();
    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = encodeBase64Url(payloadJson);
    const signature = createHmac("sha256", secret).update(payloadBase64).digest();
    const signatureBase64 = encodeBase64Url(signature);
    return `${payloadBase64}.${signatureBase64}`;
}

export function verifySession(token?: string | null): SessionPayload | null {
    const secret = getSecret();
    if (!token) return null;
    const [payloadBase64, signatureBase64] = token.split(".");
    if (!payloadBase64 || !signatureBase64) return null;

    const expectedSignature = createHmac("sha256", secret).update(payloadBase64).digest();
    const actualSignature = decodeBase64Url(signatureBase64);
    if (actualSignature.length !== expectedSignature.length) return null;
    if (!timingSafeEqual(actualSignature, expectedSignature)) return null;

    try {
        const payloadJson = decodeBase64Url(payloadBase64).toString("utf-8");
        const payload = JSON.parse(payloadJson) as SessionPayload;
        if (!payload.userId) return null;
        // Session expiry: 30 days
        if (payload.issuedAt && Date.now() - payload.issuedAt > 30 * 24 * 60 * 60 * 1000) return null;
        return payload;
    } catch {
        return null;
    }
}

/**
 * 密碼指紋：由「目前存在 DB 的密碼 hash」衍生的短 HMAC。
 * 簽進 session 後，密碼被重設（hash 改變）時舊 session 立刻失效；不用改 schema。
 * 不含密碼明文，也無法反推 hash（有 secret 參與）。
 */
export function passwordFingerprint(storedHash: string): string {
    return createHmac("sha256", getSecret()).update(`pwv:${storedHash}`).digest("base64url").slice(0, 22);
}
