// 查詢處理（今天記了什麼 / 指定日期）

import prisma from '../../src/lib/prisma';
import type { SessionData, DbContext } from '../types';
import { formatJinLiang } from '../../src/lib/units';

// 中文月份轉數字（「三月」→「3月」、「十一月」→「11月」）
function normalizeChineseDate(text: string): string {
    return text
        .replace(/十二月/, '12月')
        .replace(/十一月/, '11月')
        .replace(/十月/, '10月')
        .replace(/([一二兩三四五六七八九])月/, (_, cn: string) => {
            const map: Record<string, string> = {
                '一':'1','二':'2','兩':'2','三':'3','四':'4',
                '五':'5','六':'6','七':'7','八':'8','九':'9',
            };
            return (map[cn] ?? cn) + '月';
        });
}

// 偵測查詢意圖，回傳目標日期（或 null 代表非查詢）
export function detectQueryDate(text: string): Date | 'recent' | null {
    const t = normalizeChineseDate(text.trim());

    // 今天
    if (/今天|今日|today/.test(t)) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // 昨天
    if (/昨天|yesterday/.test(t)) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // 最近 / 近期
    if (/最近|近期|recent/.test(t)) {
        return 'recent';
    }

    // M/D 或 M月D日
    const match = t.match(/(\d{1,2})[\/月](\d{1,2})/);
    if (match) {
        const month = parseInt(match[1]) - 1;
        const day = parseInt(match[2]);
        const now = new Date();
        const d = new Date(now.getFullYear(), month, day, 0, 0, 0, 0);
        // 若指定日期在未來超過一天，可能是去年
        if (d > now) d.setFullYear(d.getFullYear() - 1);
        return d;
    }

    return null;
}

// 是否為查詢指令
export function isQueryIntent(text: string): boolean {
    const t = normalizeChineseDate(text.trim());
    // 純日期詞直接觸發查詢（不需要額外關鍵字）
    if (/^(今天|今日|昨天|昨日|最近|近期)$/.test(t)) return true;
    return detectQueryDate(text) !== null &&
        /記|記錄|記了|記了什麼|紀錄|查|什麼|多少/.test(text);
}

// 格式化日期為 M/D
function fmtDate(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 查詢指定日期的記錄並格式化（含進貨、支出、營業額）
export async function queryByDate(date: Date, session: SessionData, ctx: DbContext): Promise<string> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const [entries, revenues] = await Promise.all([
        prisma.entry.findMany({
            where: { tenantId: session.tenantId, date: { gte: date, lt: nextDay } },
            include: { item: true, vendor: true },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.revenue.findMany({
            where: { tenantId: session.tenantId, date: { gte: date, lt: nextDay } },
            include: { location: true },
            orderBy: { date: 'asc' },
        }),
    ]);

    const totalCount = entries.length + revenues.length;
    if (totalCount === 0) {
        return `📅 ${fmtDate(date)} 尚無記錄`;
    }

    const lines: string[] = [`📅 ${fmtDate(date)} 記錄（${totalCount} 筆）`];
    let purchaseTotal = 0;
    let expenseTotal = 0;
    let revenueTotal = 0;

    // 營業額
    if (revenues.length > 0) {
        lines.push('💰 營業額：');
        for (const r of revenues) {
            const note = r.note ? ` 備註：${r.note}` : '';
            lines.push(`  • ${r.location?.name ?? '?'} $${r.amount.toLocaleString()}${note}`);
            revenueTotal += r.amount;
        }
    }

    // 進貨 & 支出
    for (const e of entries) {
        if (e.type === 'PURCHASE') {
            purchaseTotal += e.totalPrice;
            const qty = e.inputQuantity != null
                ? (e.inputUnit === 'jl'
                    ? `${formatJinLiang(e.inputQuantity)} `
                    : `${e.inputQuantity}${e.inputUnit ? (ctx.units.find(u => u.code === e.inputUnit)?.name ?? e.inputUnit) : ''} `)
                : '';
            const vendor = e.vendor ? `（${e.vendor.name}）` : '';
            const note = e.note ? ` 備註：${e.note}` : '';
            lines.push(`  • ${e.item?.name ?? '?'} ${qty}$${e.totalPrice}${vendor}${note}`);
        } else {
            expenseTotal += e.totalPrice;
            const et = ctx.expenseTypes.find(t => t.value === e.expenseType);
            const note = e.note ? ` 備註：${e.note}` : '';
            lines.push(`  • ${et?.label ?? e.expenseType ?? '支出'} $${e.totalPrice}${note}`);
        }
    }

    lines.push('---');
    const parts: string[] = [];
    if (revenues.length > 0) parts.push(`營業額：$${revenueTotal.toLocaleString()}`);
    if (purchaseTotal > 0) parts.push(`進貨：$${purchaseTotal.toLocaleString()}`);
    if (expenseTotal > 0) parts.push(`支出：$${expenseTotal.toLocaleString()}`);
    lines.push(parts.join(' ｜ '));

    return lines.join('\n');
}

// 偵測廠商+月份查詢意圖
//
// Pattern: "N月 廠商名", "廠商名 N月", "查 廠商名 N月", "4月阿明進了什麼"
//
// False-positive guard (2026-04-10): a raw entry like "4月9號潮州攤位9320"
// was being swallowed by this detector and routed to the query handler
// (the leading "4月" matched, and the rest got stuffed into vendorName).
// That caused the revenue record to never reach the parser. We now reject
// matches where:
//   - the text contains "號" or "日" after the month (specific date, not a month-level query)
//   - the extracted vendor name starts with a digit (nonsense — real vendor names don't)
//   - the extracted vendor name contains a known location token like "攤位"
//   - the extracted vendor name ends with pure digits (clearly an amount)
export function detectVendorMonthQuery(text: string): { vendorName: string; month: number; year: number } | null {
    const t = normalizeChineseDate(text.trim());

    // Quick reject: if a specific date marker follows the month, this is a dated entry, not a month query.
    if (/\d{1,2}月\s*\d{1,2}\s*[日號]/.test(t)) return null;

    // Pattern: "N月 廠商名" or "廠商名 N月" or "查 廠商名 N月"
    const m1 = t.match(/(\d{1,2})月[份]?\s*(.+?)(?:\s*(?:叫|買|進|訂)了?什麼|的?(?:進貨|明細|記錄))?$/);
    const m2 = t.match(/(.+?)\s*(\d{1,2})月[份]?\s*(?:叫|買|進|訂)?了?(?:什麼|的?(?:進貨|明細|記錄))?$/);
    const match = m1 || m2;
    if (!match) return null;

    const monthStr = m1 ? match[1] : match[2];
    const vendorStr = (m1 ? match[2] : match[1]).replace(/^[查查詢問]\s*/, '').trim();
    if (!vendorStr || vendorStr.length < 1) return null;

    // False-positive guards on the extracted vendor name
    if (/^\d/.test(vendorStr)) return null;                    // starts with digit → nonsense
    if (/攤位|店面|攤販/.test(vendorStr)) return null;          // contains location keyword → probably a revenue entry
    if (/\d+\s*$/.test(vendorStr)) return null;                // ends with digits → probably an amount

    const month = parseInt(monthStr);
    if (month < 1 || month > 12) return null;

    const now = new Date();
    const year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
    return { vendorName: vendorStr, month, year };
}

// 查詢某月份某廠商的進貨記錄（含單價換算）
export async function queryByVendorMonth(
    vendorName: string, month: number, year: number,
    session: SessionData, ctx: DbContext
): Promise<string> {
    // Find matching vendor
    const vendor = ctx.vendors.find(v =>
        v.name.includes(vendorName) || vendorName.includes(v.name)
    );
    if (!vendor) {
        const available = ctx.vendors.map(v => v.name).join('、');
        return `❌ 找不到廠商「${vendorName}」\n\n目前有的廠商：${available || '（無）'}`;
    }

    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 1);

    const entries = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            type: 'PURCHASE',
            vendorId: vendor.id,
            date: { gte: from, lt: to },
        },
        include: { item: true },
        orderBy: { date: 'asc' },
    });

    if (entries.length === 0) {
        return `📋 ${year}年${month}月 ${vendor.name}：無進貨記錄`;
    }

    const lines: string[] = [`📋 ${year}年${month}月 — ${vendor.name}（${entries.length} 筆）\n`];
    let total = 0;

    // Group by item, accumulate weight (in kg) and amount for unit price calculation
    type ItemAgg = {
        totalKg: number; unitCode: string; amount: number; count: number;
        // For display: individual quantities
        entries: { qty: number; unit: string }[];
    };
    const byItem = new Map<string, ItemAgg>();
    for (const e of entries) {
        const name = e.item?.name ?? '?';
        const existing = byItem.get(name) || { totalKg: 0, unitCode: '', amount: 0, count: 0, entries: [] };
        existing.unitCode = e.inputUnit ?? '';
        existing.amount += e.totalPrice;
        existing.count += 1;
        existing.totalKg += e.standardWeight ?? 0;
        if (e.inputQuantity != null) {
            existing.entries.push({ qty: e.inputQuantity, unit: e.inputUnit ?? '' });
        }
        byItem.set(name, existing);
        total += e.totalPrice;
    }

    const KG_PER_TAIJIN = 0.6; // 1台斤 = 0.6公斤

    for (const [name, data] of byItem) {
        // Format quantity display
        let qtyStr = '';
        if (data.entries.length > 0) {
            const unitCode = data.entries[0].unit;
            if (unitCode === 'jl') {
                // 斤兩：decode each, sum in jin+liang, display as 斤兩
                let totalJin = 0, totalLiang = 0;
                for (const ent of data.entries) {
                    totalJin += Math.floor(ent.qty / 100);
                    totalLiang += Math.round(ent.qty % 100);
                }
                totalJin += Math.floor(totalLiang / 16);
                totalLiang = totalLiang % 16;
                const kgStr = data.totalKg > 0 ? `（${data.totalKg.toFixed(2)}kg）` : '';
                qtyStr = ` ${totalJin}斤${totalLiang > 0 ? totalLiang + '兩' : ''}${kgStr}`;
            } else {
                const totalQty = data.entries.reduce((s, e) => s + e.qty, 0);
                const unitName = ctx.units.find(u => u.code === unitCode)?.name ?? unitCode;
                const kgStr = data.totalKg > 0 ? `（${data.totalKg.toFixed(2)}kg）` : '';
                qtyStr = ` ${totalQty}${unitName}${kgStr}`;
            }
        }

        let priceStr = '';
        if (data.totalKg > 0 && data.amount > 0) {
            const pricePerKg = data.amount / data.totalKg;
            const pricePerTaiJin = pricePerKg * KG_PER_TAIJIN;
            priceStr = `\n    💲 單價：$${Math.round(pricePerTaiJin)}/台斤 ｜ $${Math.round(pricePerKg)}/公斤`;
        }

        lines.push(`  • ${name}${qtyStr} — $${data.amount.toLocaleString()}（${data.count}筆）${priceStr}`);
    }

    lines.push(`\n💰 合計：$${total.toLocaleString()}`);
    return lines.join('\n');
}

// 偵測日期範圍+地點查詢（例如「3月1號到3月31號屏東攤位的總營收」）
export function detectDateRangeQuery(text: string): { from: Date; to: Date; locationName?: string; type?: string } | null {
    const t = normalizeChineseDate(text.trim());

    // Pattern: M月D號到M月D號 (地點) (營收/進貨/支出)
    const m = t.match(/(\d{1,2})月(\d{1,2})[號日]?\s*(?:到|至|~|-)\s*(\d{1,2})月(\d{1,2})[號日]?\s*(.*)/);
    if (!m) return null;

    const now = new Date();
    const year = now.getFullYear();
    const from = new Date(year, parseInt(m[1]) - 1, parseInt(m[2]), 0, 0, 0, 0);
    const to = new Date(year, parseInt(m[3]) - 1, parseInt(m[4]), 23, 59, 59, 999);
    if (from > now) { from.setFullYear(year - 1); to.setFullYear(year - 1); }

    const rest = m[5].trim();

    // Extract location name and query type
    let locationName: string | undefined;
    let type: string | undefined;

    if (/營收|營業額|收入/.test(rest)) type = 'revenue';
    else if (/進貨|採購/.test(rest)) type = 'purchase';
    else if (/支出|費用/.test(rest)) type = 'expense';

    // Remove type keywords to get location
    const locStr = rest.replace(/的?(?:總?營收|總?營業額|總?收入|總?進貨|總?支出|總?費用|記錄|明細|總計)/g, '').trim();
    if (locStr.length >= 1) {
        // Clean up common suffixes
        locationName = locStr.replace(/攤位|門市|店/g, '').trim() || locStr;
    }

    return { from, to, locationName, type };
}

// 查詢日期範圍內的營收/進貨/支出
export async function queryByDateRange(
    from: Date, to: Date, locationName: string | undefined, type: string | undefined,
    session: SessionData, ctx: DbContext
): Promise<string> {
    const fromStr = `${from.getMonth()+1}/${from.getDate()}`;
    const toStr = `${to.getMonth()+1}/${to.getDate()}`;
    const toNextDay = new Date(to); toNextDay.setDate(toNextDay.getDate() + 1); toNextDay.setHours(0,0,0,0);
    const fromStart = new Date(from); fromStart.setHours(0,0,0,0);

    // Find matching location if specified
    let locationId: string | undefined;
    if (locationName) {
        const loc = ctx.locations?.find(l =>
            l.name.includes(locationName) || locationName.includes(l.name.replace(/攤位|門市|店/g, ''))
        );
        if (loc) locationId = loc.id;
    }

    const lines: string[] = [];
    const header = locationName ? `${locationName}` : '全部';
    lines.push(`📊 ${fromStr} ~ ${toStr} ${header}\n`);

    // Revenue
    if (!type || type === 'revenue') {
        const where: Record<string, unknown> = {
            tenantId: session.tenantId,
            date: { gte: fromStart, lt: toNextDay },
        };
        if (locationId) where.locationId = locationId;

        const revenues = await prisma.revenue.findMany({
            where, include: { location: true }, orderBy: { date: 'asc' },
        });

        if (revenues.length > 0) {
            // Group by location
            const byLoc = new Map<string, number>();
            let total = 0;
            for (const r of revenues) {
                const name = r.location?.name ?? '未知';
                byLoc.set(name, (byLoc.get(name) || 0) + r.amount);
                total += r.amount;
            }
            lines.push(`💰 營業額（${revenues.length} 筆）：`);
            for (const [name, amount] of byLoc) {
                lines.push(`  • ${name}：$${amount.toLocaleString()}`);
            }
            lines.push(`  📍 小計：$${total.toLocaleString()}`);
        } else if (type === 'revenue') {
            lines.push('💰 此期間無營業額記錄');
        }
    }

    // Purchases
    if (!type || type === 'purchase') {
        const entries = await prisma.entry.findMany({
            where: {
                tenantId: session.tenantId, type: 'PURCHASE',
                date: { gte: fromStart, lt: toNextDay },
            },
            include: { item: true, vendor: true }, orderBy: { date: 'asc' },
        });

        if (entries.length > 0) {
            const total = entries.reduce((s, e) => s + e.totalPrice, 0);
            lines.push(`\n🛒 進貨（${entries.length} 筆）：$${total.toLocaleString()}`);
        }
    }

    // Expenses
    if (!type || type === 'expense') {
        const entries = await prisma.entry.findMany({
            where: {
                tenantId: session.tenantId, type: 'EXPENSE',
                date: { gte: fromStart, lt: toNextDay },
            },
            orderBy: { date: 'asc' },
        });

        if (entries.length > 0) {
            const total = entries.reduce((s, e) => s + e.totalPrice, 0);
            lines.push(`\n💸 支出（${entries.length} 筆）：$${total.toLocaleString()}`);
        }
    }

    if (lines.length === 1) lines.push('此期間無記錄');
    return lines.join('\n');
}

// 查詢最近 7 天
export async function queryRecent(session: SessionData, ctx: DbContext): Promise<string> {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const [entries, revenues] = await Promise.all([
        prisma.entry.findMany({
            where: { tenantId: session.tenantId, date: { gte: since } },
            include: { item: true, vendor: true },
            orderBy: { date: 'asc' },
        }),
        prisma.revenue.findMany({
            where: { tenantId: session.tenantId, date: { gte: since } },
            include: { location: true },
            orderBy: { date: 'asc' },
        }),
    ]);

    const totalCount = entries.length + revenues.length;
    if (totalCount === 0) return '📊 最近 7 天尚無記錄';

    // 依日期分組
    type DayGroup = { entries: typeof entries; revenues: typeof revenues };
    const byDate = new Map<string, DayGroup>();
    const getOrCreate = (key: string): DayGroup => {
        if (!byDate.has(key)) byDate.set(key, { entries: [], revenues: [] });
        return byDate.get(key)!;
    };

    entries.forEach(e => {
        const key = e.date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
        getOrCreate(key).entries.push(e);
    });
    revenues.forEach(r => {
        const key = r.date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
        getOrCreate(key).revenues.push(r);
    });

    const lines: string[] = [`📊 最近 7 天（${totalCount} 筆）`];
    let grandTotal = 0;

    byDate.forEach(({ entries: dayEntries, revenues: dayRevs }, dateKey) => {
        const entryTotal = dayEntries.reduce((s, e) => s + e.totalPrice, 0);
        const revTotal = dayRevs.reduce((s, r) => s + r.amount, 0);
        const dayTotal = entryTotal + revTotal;
        grandTotal += dayTotal;
        const count = dayEntries.length + dayRevs.length;
        lines.push(`  ${dateKey}（${count} 筆，$${dayTotal.toLocaleString()}）`);
    });

    lines.push(`---\n總計：$${grandTotal.toLocaleString()}`);
    return lines.join('\n');
}
