import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";

const BCRYPT_COST = 12;

function isBcryptHash(stored: string): boolean {
    return stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$");
}

function isSha256Hex(stored: string): boolean {
    return /^[0-9a-f]{64}$/i.test(stored);
}

export function hashPassword(plain: string): string {
    return bcrypt.hashSync(plain, BCRYPT_COST);
}

export interface VerifyResult {
    ok: boolean;
    needsRehash: boolean;
}

// 驗證密碼：自動偵測是 bcrypt ($2...) 還是 legacy SHA-256。
// legacy 驗證通過 → needsRehash=true，呼叫端請用 hashPassword() 升級後寫回 DB。
export function verifyPassword(plain: string, stored: string): VerifyResult {
    if (!stored) return { ok: false, needsRehash: false };

    if (isBcryptHash(stored)) {
        try {
            return { ok: bcrypt.compareSync(plain, stored), needsRehash: false };
        } catch {
            return { ok: false, needsRehash: false };
        }
    }

    if (isSha256Hex(stored)) {
        const computed = createHash("sha256").update(plain).digest();
        const storedBuf = Buffer.from(stored, "hex");
        if (computed.length !== storedBuf.length) {
            return { ok: false, needsRehash: false };
        }
        const ok = timingSafeEqual(computed, storedBuf);
        return { ok, needsRehash: ok };
    }

    return { ok: false, needsRehash: false };
}
