/**
 * 跨租戶外鍵檢查。
 *
 * 所有「client 傳來的 id 要寫進本租戶資料」的地方（itemId / vendorId / locationId /
 * categoryId / checklistItemId ...）都先用這支確認該 id 真的屬於呼叫者的租戶，
 * 否則 A 租戶可以把 B 租戶的 id 填進自己的資料（讀到 B 的名稱、或污染關聯）。
 */
import prisma from "@/lib/prisma";

export type TenantScopedModel = "item" | "vendor" | "location" | "category" | "checklistItem" | "entryTemplate";

type FindFirstArgs = { where: { id: string; tenantId: string }; select: { id: true } };
export type TenantGuardDb = Record<TenantScopedModel, { findFirst(args: FindFirstArgs): Promise<{ id: string } | null> }>;

const MODEL_LABEL: Record<TenantScopedModel, string> = {
    item: "品項",
    vendor: "廠商",
    location: "地點",
    category: "分類",
    checklistItem: "檢查項目",
    entryTemplate: "常用記錄",
};

export class TenantOwnershipError extends Error {
    constructor(public readonly model: TenantScopedModel) {
        super(`找不到${MODEL_LABEL[model]}或無權限`);
        this.name = "TenantOwnershipError";
    }
}

export async function tenantOwns(
    model: TenantScopedModel,
    id: string,
    tenantId: string,
    db: TenantGuardDb = prisma as unknown as TenantGuardDb,
): Promise<boolean> {
    if (!id || !tenantId) return false;
    const row = await db[model].findFirst({ where: { id, tenantId }, select: { id: true } });
    return row !== null;
}

/** 不屬於該租戶就 throw TenantOwnershipError（message 可直接顯示給使用者）。 */
export async function assertTenantOwns(
    model: TenantScopedModel,
    id: string,
    tenantId: string,
    db: TenantGuardDb = prisma as unknown as TenantGuardDb,
): Promise<void> {
    if (!(await tenantOwns(model, id, tenantId, db))) throw new TenantOwnershipError(model);
}

/** 一次檢查多個 id（去重後逐一確認）。 */
export async function assertTenantOwnsAll(
    model: TenantScopedModel,
    ids: string[],
    tenantId: string,
    db: TenantGuardDb = prisma as unknown as TenantGuardDb,
): Promise<void> {
    for (const id of new Set(ids)) await assertTenantOwns(model, id, tenantId, db);
}

/**
 * 給 server action 用：檢查一組 [model, id] 參照（id 為空會略過），
 * 回傳第一個不屬於該租戶的錯誤訊息；全部通過回 null。
 */
export async function checkTenantRefs(
    tenantId: string,
    refs: Array<[TenantScopedModel, string | null | undefined]>,
    db: TenantGuardDb = prisma as unknown as TenantGuardDb,
): Promise<string | null> {
    for (const [model, id] of refs) {
        if (!id) continue;
        if (!(await tenantOwns(model, id, tenantId, db))) return new TenantOwnershipError(model).message;
    }
    return null;
}
