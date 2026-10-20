import test from "node:test";
import assert from "node:assert/strict";
import { assertTenantOwns, assertTenantOwnsAll, tenantOwns, TenantOwnershipError, type TenantGuardDb } from "./tenant-guard";

// 假資料庫：每個 model 一張 id -> tenantId 的表
function fakeDb(rows: Record<string, Record<string, string>>): TenantGuardDb {
    const make = (model: string) => ({
        async findFirst(args: { where: { id: string; tenantId: string } }) {
            return rows[model]?.[args.where.id] === args.where.tenantId ? { id: args.where.id } : null;
        },
    });
    return {
        item: make("item"), vendor: make("vendor"), location: make("location"),
        category: make("category"), checklistItem: make("checklistItem"), entryTemplate: make("entryTemplate"),
    };
}

const db = fakeDb({
    item: { 品項甲: "租戶A", 品項乙: "租戶B" },
    location: { 屏東攤位: "租戶A" },
});

test("自己租戶的 id 通過", async () => {
    assert.equal(await tenantOwns("item", "品項甲", "租戶A", db), true);
    await assert.doesNotReject(assertTenantOwns("location", "屏東攤位", "租戶A", db));
});

test("別的租戶的 id 被擋", async () => {
    assert.equal(await tenantOwns("item", "品項乙", "租戶A", db), false);
    await assert.rejects(assertTenantOwns("item", "品項乙", "租戶A", db), TenantOwnershipError);
});

test("不存在或空字串被擋，錯誤訊息是中文", async () => {
    await assert.rejects(assertTenantOwns("vendor", "不存在", "租戶A", db), /廠商/);
    assert.equal(await tenantOwns("item", "", "租戶A", db), false);
});

test("assertTenantOwnsAll 有一個不屬於就失敗", async () => {
    await assert.doesNotReject(assertTenantOwnsAll("item", ["品項甲", "品項甲"], "租戶A", db));
    await assert.rejects(assertTenantOwnsAll("item", ["品項甲", "品項乙"], "租戶A", db), TenantOwnershipError);
});

test("checkTenantRefs: 全部通過回 null，空 id 略過，第一個外來 id 回中文訊息", async () => {
    const { checkTenantRefs } = await import("./tenant-guard");
    assert.equal(await checkTenantRefs("租戶A", [["item", "品項甲"], ["vendor", null], ["vendor", undefined]], db), null);
    assert.equal(await checkTenantRefs("租戶A", [["item", "品項甲"], ["item", "品項乙"]], db), "找不到品項或無權限");
    assert.equal(await checkTenantRefs("租戶A", [["location", "不存在"]], db), "找不到地點或無權限");
});
