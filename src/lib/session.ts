import { createHmac, timingSafeEqual } from "crypto";

export type SessionPayload = {
    userId: string;
    issuedAt: number;
};

const SECRET = process.env.SESSION_SECRET || "dev-secret";

function encodeBase64Url(input: string | Buffer) {
    return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string) {
    return Buffer.from(input, "base64url");
}

export function signSession(payload: SessionPayload) {
    const payloadJson = JSON.stringify(payload);
    const payloadBase64 = encodeBase64Url(payloadJson);
    const signature = createHmac("sha256", SECRET).update(payloadBase64).digest();
    const signatureBase64 = encodeBase64Url(signature);
    return `${payloadBase64}.${signatureBase64}`;
}

export function verifySession(token?: string | null): SessionPayload | null {
    if (!token) return null;
    const [payloadBase64, signatureBase64] = token.split(".");
    if (!payloadBase64 || !signatureBase64) return null;

    const expectedSignature = createHmac("sha256", SECRET).update(payloadBase64).digest();
    const actualSignature = decodeBase64Url(signatureBase64);
    if (actualSignature.length !== expectedSignature.length) return null;
    if (!timingSafeEqual(actualSignature, expectedSignature)) return null;

    try {
        const payloadJson = decodeBase64Url(payloadBase64).toString("utf-8");
        const payload = JSON.parse(payloadJson) as SessionPayload;
        if (!payload.userId) return null;
        return payload;
    } catch {
        return null;
    }
}
