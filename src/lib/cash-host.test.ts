import test from "node:test";
import assert from "node:assert/strict";
import { decideCashRoute, isCashHost } from "./cash-host";

const CASH = "cash.hongjixuan-market-ledger.com";

test("isCashHost 認得 cash 網域、忽略 port 與大小寫", () => {
    assert.equal(isCashHost(CASH), true);
    assert.equal(isCashHost("CASH.localhost:3113"), true);
    assert.equal(isCashHost("hongjixuan-market-ledger.com"), false);
    assert.equal(isCashHost(null), false);
});

test("主站網域不 rewrite", () => {
    assert.deepEqual(decideCashRoute("hongjixuan-market-ledger.com", "/"), { action: "next" });
});

test("cash 網域的根路徑與一般頁面 rewrite 到 /cash", () => {
    assert.deepEqual(decideCashRoute(CASH, "/"), { action: "rewrite", pathname: "/cash" });
    assert.deepEqual(decideCashRoute(CASH, "/history"), { action: "rewrite", pathname: "/cash/history" });
    assert.deepEqual(decideCashRoute(CASH, "/login"), { action: "rewrite", pathname: "/cash/login" });
});

test("已經是 /cash 或 /cash/ 開頭不重複 rewrite", () => {
    assert.deepEqual(decideCashRoute(CASH, "/cash"), { action: "next" });
    assert.deepEqual(decideCashRoute(CASH, "/cash/history"), { action: "next" });
});

test("/cashfoo 不是 /cash，要 rewrite", () => {
    assert.deepEqual(decideCashRoute(CASH, "/cashfoo"), { action: "rewrite", pathname: "/cash/cashfoo" });
});

test("/api/ 路徑不 rewrite（匯出 API 才打得到）", () => {
    assert.deepEqual(decideCashRoute(CASH, "/api/cash/export"), { action: "next" });
    assert.deepEqual(decideCashRoute(CASH, "/api/auth/anything"), { action: "next" });
    assert.deepEqual(decideCashRoute(CASH, "/apiary"), { action: "rewrite", pathname: "/cash/apiary" });
});
