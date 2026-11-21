// 已知裝置 cookie 的單元測試（純函式，不碰 DB）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_DEVICE_MAX_AGE_SEC, signKnownDevice, verifyKnownDevice } from "./known-device";
import { passwordFingerprint, signSession, verifySession } from "./session";

const T0 = 1_800_000_000_000;
const pwv = passwordFingerprint("$2b$12$老闆的密碼雜湊");

test("已知裝置：簽章正確、userId 與 pwv 相符時通過", () => {
    const token = signKnownDevice({ userId: "u-老闆", pwv, issuedAt: T0 });
    assert.equal(verifyKnownDevice(token, { userId: "u-老闆", pwv }, T0 + 1000), true);
});

test("已知裝置：內容被竄改（換成別人的 userId）驗不過", () => {
    const token = signKnownDevice({ userId: "u-媽媽", pwv, issuedAt: T0 });
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "u-老闆", pwv, issuedAt: T0 })).toString("base64url");
    assert.equal(verifyKnownDevice(`${forged}.${sig}`, { userId: "u-老闆", pwv }, T0), false);
    assert.equal(verifyKnownDevice(token.slice(0, -2) + "xx", { userId: "u-媽媽", pwv }, T0), false);
});

test("已知裝置：別人的 cookie 不能拿來通過這個 user", () => {
    const token = signKnownDevice({ userId: "u-媽媽", pwv, issuedAt: T0 });
    assert.equal(verifyKnownDevice(token, { userId: "u-老闆", pwv }, T0), false);
});

test("已知裝置：密碼改了（pwv 變了）舊 cookie 失效", () => {
    const token = signKnownDevice({ userId: "u-老闆", pwv, issuedAt: T0 });
    const newPwv = passwordFingerprint("$2b$12$新的密碼雜湊");
    assert.equal(verifyKnownDevice(token, { userId: "u-老闆", pwv: newPwv }, T0), false);
});

test("已知裝置：超過 180 天過期，未來時間也不收", () => {
    const token = signKnownDevice({ userId: "u-老闆", pwv, issuedAt: T0 });
    const ms = KNOWN_DEVICE_MAX_AGE_SEC * 1000;
    assert.equal(verifyKnownDevice(token, { userId: "u-老闆", pwv }, T0 + ms - 1), true);
    assert.equal(verifyKnownDevice(token, { userId: "u-老闆", pwv }, T0 + ms + 1), false);
    const future = signKnownDevice({ userId: "u-老闆", pwv, issuedAt: T0 + 3_600_000 });
    assert.equal(verifyKnownDevice(future, { userId: "u-老闆", pwv }, T0), false);
});

test("已知裝置：垃圾輸入與空值一律不通過", () => {
    for (const bad of [undefined, null, "", "abc", "a.b.c", ".", "亂碼.亂碼"]) {
        assert.equal(verifyKnownDevice(bad, { userId: "u-老闆", pwv }, T0), false);
    }
});

test("已知裝置：與 session 簽章用途分開，彼此不能互相冒充", () => {
    const session = signSession({ userId: "u-老闆", tenantId: null, isSuperAdmin: false, issuedAt: T0, pwv });
    assert.equal(verifyKnownDevice(session, { userId: "u-老闆", pwv }, T0), false);
    const kd = signKnownDevice({ userId: "u-老闆", pwv, issuedAt: Date.now() });
    assert.equal(verifySession(kd), null);
});
