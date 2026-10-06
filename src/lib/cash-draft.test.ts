// T-ML-034：清點草稿機制（原樣從 CashCountForm 搬出來的純函式）。
// 重點是鎖住「key 格式」與「什麼算有內容」這兩個行為不能變，
// 因為舊版已經存在員工手機 sessionStorage 裡的草稿要能被新版讀回來。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    CASH_DRAFT_PREFIX,
    DRAFT_SCHEMA_VERSION,
    draftHasContent,
    draftKey,
    hasCashDraft,
    type DraftPayload,
} from "./cash-draft";

function emptyDraft(): DraftPayload {
    return {
        v: DRAFT_SCHEMA_VERSION,
        cashBox: { "500": "", "100": "" },
        reserve: { "1000": "", "500": "" },
        sales: { "1000": "", "500": "" },
        expenses: [{ item: "", note: "", amount: "" }],
        checkedIds: [],
        signature: null,
        note: "",
        savedAt: 1,
    };
}

test("draftKey: 格式固定為 cashcount-draft:${attendantId}:${date}（舊版草稿要能被新版讀到）", () => {
    assert.equal(draftKey("user_清點員一號", "2026-10-06"), "cashcount-draft:user_清點員一號:2026-10-06");
    assert.ok(draftKey("a", "b").startsWith(CASH_DRAFT_PREFIX));
    assert.equal(CASH_DRAFT_PREFIX, "cashcount-draft:");
    assert.equal(DRAFT_SCHEMA_VERSION, 1);
});

test("draftHasContent: 全空的草稿不算有內容", () => {
    assert.equal(draftHasContent(emptyDraft()), false);
});

test("draftHasContent: 張數填 0 或空白不算有內容，填大於 0 才算", () => {
    const d = emptyDraft();
    d.cashBox["500"] = "0";
    assert.equal(draftHasContent(d), false);
    d.cashBox["500"] = "3";
    assert.equal(draftHasContent(d), true);
});

test("draftHasContent: 簽名、備註、勾選動作、支出任一有內容就算", () => {
    const sig = emptyDraft();
    sig.signature = "data:image/png;base64,AAAA";
    assert.equal(draftHasContent(sig), true);

    const note = emptyDraft();
    note.note = "  今天下雨  ";
    assert.equal(draftHasContent(note), true);

    const blankNote = emptyDraft();
    blankNote.note = "   ";
    assert.equal(draftHasContent(blankNote), false);

    const checked = emptyDraft();
    checked.checkedIds = ["瓦斯兩桶"];
    assert.equal(draftHasContent(checked), true);

    const expense = emptyDraft();
    expense.expenses = [{ item: "大腸", note: "", amount: "" }];
    assert.equal(draftHasContent(expense), true);

    const amountOnly = emptyDraft();
    amountOnly.expenses = [{ item: "", note: "", amount: "250" }];
    assert.equal(draftHasContent(amountOnly), true);
});

function fakeStorage(keys: string[]) {
    return { length: keys.length, key: (i: number) => keys[i] ?? null };
}

test("hasCashDraft: sessionStorage 內有 cashcount-draft: 開頭的 key 才回 true（登出前提醒用）", () => {
    assert.equal(hasCashDraft(fakeStorage([])), false);
    assert.equal(hasCashDraft(fakeStorage(["theme", "其他網站的資料"])), false);
    assert.equal(hasCashDraft(fakeStorage(["theme", "cashcount-draft:u1:2026-10-06"])), true);
    // 只是相似的前綴不算
    assert.equal(hasCashDraft(fakeStorage(["cashcount-draftX:u1"])), false);
});
