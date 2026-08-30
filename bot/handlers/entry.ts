// 進貨/支出寫入 DB + 重複偵測

import prisma from '../../src/lib/prisma';
import type { ParsedEntry, SessionData } from '../types';
import { checkDuplicate } from '../matcher';
import type { DbContext } from '../types';
import { formatJinLiang, jinLiangToKg } from '../../src/lib/units';
import { previewFixedExpenses, applyFixedExpenses, stallForLocation, realEntryDb } from '../../src/lib/fixedExpenseAutofill';

// 判斷日期是否為今天（台北時區）
function isToday(dateStr: string): boolean {
    const today = new Date().toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\//g, '-');
    return dateStr === today;
}

// 格式化日期為簡短顯示（如 3/29）
function shortDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 格式化單筆記錄顯示文字
export function formatEntry(e: ParsedEntry, ctx: DbContext): string {
    const datePrefix = e.date && !isToday(e.date) ? `📅${shortDate(e.date)} ` : '';
    if (e.type === 'REVENUE') {
        const loc = e.locationId ? ctx.locations.find(l => l.id === e.locationId) : null;
        const amountDisplay = e.isDayOff ? '💤 休假' : `$${e.price.toLocaleString()}`;
        const parts = [
            `💰 ${loc?.name ?? e.locationName ?? '未知地點'}`,
            amountDisplay,
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return datePrefix + parts.join(' ');
    }
    if (e.type === 'PURCHASE') {
        const item = ctx.items.find(i => i.id === e.itemId);
        const vendor = e.vendorId ? ctx.vendors.find(v => v.id === e.vendorId) : null;
        const unitName = e.unit ? (ctx.units.find(u => u.code === e.unit)?.name ?? e.unit) : '';
        const qtyDisplay = e.quantity != null
            ? (e.unit === 'jl' ? formatJinLiang(e.quantity) : `${e.quantity}${unitName}`)
            : '';
        const parts = [
            item?.name ?? e.itemName ?? '未知品項',
            qtyDisplay,
            `$${e.price}`,
            vendor ? `（${vendor.name}）` : '',
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return datePrefix + parts.join(' ');
    } else {
        const et = ctx.expenseTypes.find(t => t.value === e.expenseType);
        const parts = [
            et?.label ?? e.expenseType ?? '支出',
            `$${e.price}`,
            e.note ? `備註：${e.note}` : '',
        ].filter(Boolean);
        return datePrefix + parts.join(' ');
    }
}

// 寫入單筆記錄到 DB
export async function saveEntry(entry: ParsedEntry, session: SessionData): Promise<{ success: boolean; error?: string }> {
    try {
        const date = new Date(entry.date);

        // 營業額走獨立的 Revenue 表
        if (entry.type === 'REVENUE') {
            if (!entry.locationId) return { success: false, error: '缺少地點 ID' };

            // 休假日：同日同 location 已有紀錄不覆寫，避免誤把營業日改成休假
            if (entry.isDayOff) {
                const dup = await prisma.revenue.findFirst({
                    where: { date, locationId: entry.locationId, tenantId: session.tenantId },
                    include: { location: true },
                });
                if (dup) {
                    const locName = dup.location?.name ?? '';
                    const existingDesc = dup.isDayOff ? '休假' : `$${dup.amount}`;
                    return { success: false, error: `${locName} 該日已有紀錄（${existingDesc}），請先刪除或修改後再記休假` };
                }
                await prisma.revenue.create({
                    data: {
                        date,
                        locationId: entry.locationId,
                        amount: 0,
                        isDayOff: true,
                        note: entry.note ?? null,
                        tenantId: session.tenantId,
                    },
                });
                return { success: true };
            }

            await prisma.revenue.upsert({
                where: {
                    date_locationId_tenantId: {
                        date,
                        locationId: entry.locationId,
                        tenantId: session.tenantId,
                    },
                },
                update: { amount: entry.price, isDayOff: false, note: entry.note ?? null, updatedAt: new Date() },
                create: {
                    date,
                    locationId: entry.locationId,
                    amount: entry.price,
                    isDayOff: false,
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
                if (entry.unit === 'jl') {
                    // jl = 斤兩，encoded as jin*100+liang
                    const kg = jinLiangToKg(entry.quantity);
                    data.standardWeight = Math.round(kg * 10000) / 10000;
                    data.unitPrice = kg > 0 ? entry.price / kg : null;
                } else {
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
                        } catch (err) {
                            console.warn('[bot/entry] malformed unit.meta for', entry.unit, '-', (err as Error)?.message ?? err);
                        }
                    }
                    if (!data.unitPrice && entry.quantity > 0) {
                        data.unitPrice = entry.price / entry.quantity;
                    }
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

// T-ML-027 範圍 A（bot 入口）：營業額記錄成功後自動帶固定支出（清潔費+洗攤）。
// bot 沒有互動式 UI 做「可預覽/可改」，所以採「自動代入 + 訊息中明列 + 告知如何
// 撤銷」的折衷：實際建立的每一筆都是普通 Entry，使用者本來就能到網頁進貨/支出
// 紀錄頁刪除或修改（沿用既有 deleteEntry 能力），不是黑箱寫入。冪等由
// applyFixedExpenses 內部保證（同日同攤同類型已存在就跳過，不會重複建立）。
export async function autofillFixedExpensesForSaved(
    saved: ParsedEntry[],
    session: SessionData
): Promise<string[]> {
    const lines: string[] = [];
    for (const entry of saved) {
        if (entry.type !== 'REVENUE' || entry.isDayOff || !entry.locationId) continue;

        const date = new Date(entry.date);
        const stall = await stallForLocation(session.tenantId, entry.locationId);
        if (!stall) continue;

        const preview = await previewFixedExpenses(session.tenantId, date, entry.locationId);
        if (!preview) continue;

        const toApply = preview.items
            .filter((it) => !it.alreadyExists)
            .map((it) => ({ expenseType: it.expenseType, expenseLabel: it.expenseLabel, amount: it.amount }));
        if (toApply.length === 0) continue;

        const result = await applyFixedExpenses(realEntryDb, session.tenantId, date, stall, session.userId ?? null, toApply);
        if (result.created.length > 0) {
            const desc = result.created.map((c) => `${c.expenseLabel} $${c.amount}`).join('、');
            lines.push(`🧾 已自動帶入固定支出：${desc}\n（如需修改/刪除請到網頁支出紀錄頁調整該筆）`);
        }
    }
    return lines;
}

// 批量處理解析後的記錄，回傳結果摘要文字
export async function processEntries(
    entries: ParsedEntry[],
    session: SessionData,
    ctx: DbContext,
): Promise<{
    saved: ParsedEntry[];
    failed: { entry: ParsedEntry; error: string }[];
}> {
    const saved: ParsedEntry[] = [];
    const failed: { entry: ParsedEntry; error: string }[] = [];

    for (const entry of entries) {
        const result = await saveEntry(entry, session);
        if (result.success) {
            saved.push(entry);
        } else {
            failed.push({ entry, error: result.error ?? '未知錯誤' });
        }
    }

    return { saved, failed };
}

// 格式化處理結果摘要
export function formatSummary(
    saved: ParsedEntry[],
    failed: { entry: ParsedEntry; error: string }[],
    ctx: DbContext,
): string {
    const lines: string[] = [];

    if (saved.length > 0) {
        lines.push(`✅ 已記錄 ${saved.length} 筆：`);
        saved.forEach(e => lines.push(`  • ${formatEntry(e, ctx)}`));
    }

    if (failed.length > 0) {
        lines.push(`❌ 儲存失敗 ${failed.length} 筆：`);
        failed.forEach(({ entry, error }) => lines.push(`  • ${formatEntry(entry, ctx)}（${error}）`));
    }

    return lines.join('\n') || '（無結果）';
}
