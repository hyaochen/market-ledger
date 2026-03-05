// 進貨/支出寫入 DB + 重複偵測

import prisma from '../../src/lib/prisma';
import type { ParsedEntry, SessionData } from '../types';
import { checkDuplicate } from '../matcher';
import type { DbContext } from '../types';

// 格式化單筆記錄顯示文字
export function formatEntry(e: ParsedEntry, ctx: DbContext): string {
    if (e.type === 'REVENUE') {
        const loc = e.locationId ? ctx.locations.find(l => l.id === e.locationId) : null;
        const parts = [
            `💰 ${loc?.name ?? e.locationName ?? '未知地點'}`,
            `$${e.price.toLocaleString()}`,
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return parts.join(' ');
    }
    if (e.type === 'PURCHASE') {
        const item = ctx.items.find(i => i.id === e.itemId);
        const vendor = e.vendorId ? ctx.vendors.find(v => v.id === e.vendorId) : null;
        const unitName = e.unit ? (ctx.units.find(u => u.code === e.unit)?.name ?? e.unit) : '';
        const parts = [
            item?.name ?? e.itemName ?? '未知品項',
            e.quantity != null ? `${e.quantity}${unitName}` : '',
            `$${e.price}`,
            vendor ? `（${vendor.name}）` : '',
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return parts.join(' ');
    } else {
        const et = ctx.expenseTypes.find(t => t.value === e.expenseType);
        const parts = [
            et?.label ?? e.expenseType ?? '支出',
            `$${e.price}`,
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return parts.join(' ');
    }
}

// 寫入單筆記錄到 DB
export async function saveEntry(entry: ParsedEntry, session: SessionData): Promise<{ success: boolean; error?: string }> {
    try {
        const date = new Date(entry.date);

        // 營業額走獨立的 Revenue 表
        if (entry.type === 'REVENUE') {
            if (!entry.locationId) return { success: false, error: '缺少地點 ID' };
            await prisma.revenue.upsert({
                where: {
                    date_locationId_tenantId: {
                        date,
                        locationId: entry.locationId,
                        tenantId: session.tenantId,
                    },
                },
                update: { amount: entry.price, note: entry.note ?? null, updatedAt: new Date() },
                create: {
                    date,
                    locationId: entry.locationId,
                    amount: entry.price,
                    note: entry.note ?? null,
                    tenantId: session.tenantId,
                },
            });
            return { success: true };
        }

        const data: Record<string, unknown> = {
            type: entry.type,
            date,
            status: 'APPROVED',
            totalPrice: entry.price,
            note: entry.note ?? null,
            userId: session.userId,
            tenantId: session.tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        if (entry.type === 'PURCHASE') {
            if (!entry.itemId) return { success: false, error: '缺少品項 ID' };
            data.itemId = entry.itemId;
            data.vendorId = entry.vendorId ?? null;
            data.inputQuantity = entry.quantity ?? null;
            data.inputUnit = entry.unit ?? null;

            // 計算標準重量（若有換算率）
            if (entry.quantity && entry.unit) {
                const unitDict = await prisma.dictionary.findFirst({
                    where: { category: 'unit', value: entry.unit, tenantId: session.tenantId },
                });
                if (unitDict?.meta) {
                    try {
                        const meta = JSON.parse(unitDict.meta);
                        if (typeof meta.toKg === 'number') {
                            data.standardWeight = entry.quantity * meta.toKg;
                            data.unitPrice = entry.price / (entry.quantity * meta.toKg);
                        }
                    } catch { /* ignore */ }
                }
                if (!data.unitPrice && entry.quantity > 0) {
                    data.unitPrice = entry.price / entry.quantity;
                }
            }
        } else {
            if (!entry.expenseType) return { success: false, error: '缺少支出類型' };
            data.expenseType = entry.expenseType;
            data.inputQuantity = entry.quantity ?? null;
            data.inputUnit = entry.unit ?? null;
        }

        await prisma.entry.create({ data: data as Parameters<typeof prisma.entry.create>[0]['data'] });
        return { success: true };
    } catch (e) {
        console.error('[saveEntry]', e);
        return { success: false, error: String(e) };
    }
}

// 批量處理解析後的記錄，回傳結果摘要文字
export async function processEntries(
    entries: ParsedEntry[],
    session: SessionData,
    ctx: DbContext,
): Promise<{
    saved: ParsedEntry[];
    duplicates: { entry: ParsedEntry; existing: { id: string; totalPrice: number; note: string | null } }[];
    failed: { entry: ParsedEntry; error: string }[];
}> {
    const saved: ParsedEntry[] = [];
    const duplicates: { entry: ParsedEntry; existing: { id: string; totalPrice: number; note: string | null } }[] = [];
    const failed: { entry: ParsedEntry; error: string }[] = [];

    for (const entry of entries) {
        // 重複偵測已移至 enrichEntry，使用者確認後直接儲存
        const result = await saveEntry(entry, session);
        if (result.success) {
            saved.push(entry);
        } else {
            failed.push({ entry, error: result.error ?? '未知錯誤' });
        }
    }

    return { saved, duplicates, failed };
}

// 格式化處理結果摘要
export function formatSummary(
    saved: ParsedEntry[],
    duplicates: { entry: ParsedEntry; existing: { id: string; totalPrice: number; note: string | null } }[],
    failed: { entry: ParsedEntry; error: string }[],
    ctx: DbContext,
): string {
    const lines: string[] = [];

    if (saved.length > 0) {
        lines.push(`✅ 已記錄 ${saved.length} 筆：`);
        saved.forEach(e => lines.push(`  • ${formatEntry(e, ctx)}`));
    }

    if (duplicates.length > 0) {
        lines.push(`⚠️ 重複（已略過）${duplicates.length} 筆：`);
        duplicates.forEach(({ entry }) => lines.push(`  • ${formatEntry(entry, ctx)}（今天已有相同記錄）`));
    }

    if (failed.length > 0) {
        lines.push(`❌ 儲存失敗 ${failed.length} 筆：`);
        failed.forEach(({ entry, error }) => lines.push(`  • ${formatEntry(entry, ctx)}（${error}）`));
    }

    return lines.join('\n') || '（無結果）';
}
