import test from "node:test";
import assert from "node:assert/strict";
import { pickSupervisorName, supervisorNameFromEnv } from "./cash-supervisor";

test("有租戶設定就用設定（去頭尾空白）", () => {
    assert.equal(pickSupervisorName(" 王大明 ", ["李小華"]), "王大明");
});

test("沒設定就用第一位有名字的 admin", () => {
    assert.equal(pickSupervisorName(null, [null, "  ", "李小華", "張三"]), "李小華");
});

test("都沒有回空字串", () => {
    assert.equal(pickSupervisorName(undefined, []), "");
    assert.equal(pickSupervisorName("", [null]), "");
});

test("supervisorNameFromEnv：依租戶代碼取名字，不分大小寫，找不到回空字串", () => {
    const raw = "Default=王小明, demo=示範覆核人";
    assert.equal(supervisorNameFromEnv(raw, "default"), "王小明");
    assert.equal(supervisorNameFromEnv(raw, "DEMO"), "示範覆核人");
    assert.equal(supervisorNameFromEnv(raw, "其他租戶"), "");
    assert.equal(supervisorNameFromEnv(undefined, "default"), "");
    assert.equal(supervisorNameFromEnv(raw, null), "");
});
