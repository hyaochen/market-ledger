// 已登入者傳來的兩段文字要不要當成憑證（只看形狀的那一層）。
// 重點是純數字帳號（員工帳號「1」「2」）不能讓日期、數量、記帳內容被誤刪。
// Run: npm run test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyCredentialPair, isNumericUsername, parseLoginInput } from './auth';

function looksLikeCredentials(text: string): boolean {
    const parsed = parseLoginInput(text);
    return parsed ? isLikelyCredentialPair(parsed, text) : false;
}

test('isNumericUsername：純數字才算', () => {
    assert.equal(isNumericUsername('1'), true);
    assert.equal(isNumericUsername(' 22 '), true);
    assert.equal(isNumericUsername('mom'), false);
    assert.equal(isNumericUsername('a1'), false);
    assert.equal(isNumericUsername(''), false);
});

test('純數字帳號：日期、數量、記帳內容不當成憑證', () => {
    for (const text of ['1/20', '2/5', '1 500', '2 300', '1 18820', '2 12.5', '1 2026-11-21', '2 10:30', '1 kg', '2 abc']) {
        assert.equal(looksLikeCredentials(text), false, text);
    }
});

test('含中文的兩段文字一律不當成憑證（記帳內容）', () => {
    for (const text of ['2 斤', '1 包', '2 大腸', '大腸 500', '豬耳 2斤', 'mom 大腸', '洗攤 300']) {
        assert.equal(looksLikeCredentials(text), false, text);
    }
});

test('英數帳號加第二段：當成憑證候選（是否真有此帳號由呼叫端查）', () => {
    for (const text of ['mom abcd1234', 'admin/abcd1234', 'Chen Passw0rd!', 'wang 12345678']) {
        assert.equal(looksLikeCredentials(text), true, text);
    }
});

test('純數字帳號加夠長且不像數字的第二段：當成憑證候選', () => {
    assert.equal(looksLikeCredentials('1 abcd1234'), true);
    assert.equal(looksLikeCredentials('2/Passw0rd!'), true);
    // 8 碼以上但全是數字，和金額分不出來：不當成憑證
    assert.equal(looksLikeCredentials('1 12345678'), false);
});

test('明寫「帳號X 密碼Y」一律當成憑證，純數字帳號也是', () => {
    assert.equal(looksLikeCredentials('帳號1 密碼0000'), true);
    assert.equal(looksLikeCredentials('帳號 mom 密碼 abcd1234'), true);
});

test('不是兩段文字的不會進到這個判斷', () => {
    assert.equal(looksLikeCredentials('大腸 2斤 500'), false);
    assert.equal(looksLikeCredentials('今天營業額'), false);
});
