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

    // 前天（F6 fix）
    if (/前天/.test(t)) {
        const d = new Date();
        d.setDate(d.getDate() - 2);
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
    if (/^(今天|今日|昨天|昨日|前天|最近|近期)$/.test(t)) return true;
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
    // 包含類型詞 → 是「整月查詢」不是 vendor query（會由 detectMonthYearQuery 接手）
    if (/支出|費用|營收|營業額|收入|採購|總計|彙整|統計|匯總|淨利|毛利/.test(vendorStr)) return null;
    // 備註查詢 → 由 detectNoteQuery 接手
    if (/備註/.test(vendorStr)) return null;
    // 排行詞 → 由 detectRankingQuery 接手
    if (/TOP|top|排行|最大|最熱|熱賣|榜/.test(vendorStr)) return null;
    // 比較詞 → 由 detectComparisonQuery 接手
    if (/比|對比|環比|同比/.test(vendorStr)) return null;

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

// ============================================================
// 新增查詢功能（2026-04-11）
// ============================================================

// ── helper: 解析「本月/上月/N月/今年/去年/N年」轉換成日期區間 ─────────
function resolvePeriod(text: string): { from: Date; to: Date; label: string } | null {
    const t = normalizeChineseDate(text.trim());
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    // 月份範圍：「4月到5月」「3月～5月」「2月-4月」（不含具體日期）
    // 必須先檢查，避免被 single-month pattern 攔截
    const rangeMatch = t.match(/(\d{1,2})月(?![\d/日號]).*?(?:到|至|~|－|-).*?(\d{1,2})月/);
    if (rangeMatch) {
        const m1 = parseInt(rangeMatch[1]);
        const m2 = parseInt(rangeMatch[2]);
        if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12) {
            const cur = m + 1;
            // y1: 用單月邏輯（未來月份回推到去年）
            const y1 = m1 > cur ? y - 1 : y;
            // y2: 預設等於 y1（同年範圍），若 m2 < m1 才視為跨年（y1+1）
            const y2 = m2 < m1 ? y1 + 1 : y1;
            return {
                from: new Date(y1, m1 - 1, 1),
                to: new Date(y2, m2, 1),  // exclusive end → 下個月1號
                label: y1 === y2 ? `${y1}年${m1}-${m2}月` : `${y1}/${m1}-${y2}/${m2}`,
            };
        }
    }

    // 「本月」
    if (/本月|當月|這個月/.test(t)) {
        const from = new Date(y, m, 1);
        const to = new Date(y, m + 1, 1);
        return { from, to, label: `${y}年${m + 1}月` };
    }
    // 「上月」
    if (/上月|上個月|前一個月/.test(t)) {
        const from = new Date(y, m - 1, 1);
        const to = new Date(y, m, 1);
        return { from, to, label: `${y}年${m}月` };
    }
    // 「今年」
    if (/今年|本年/.test(t)) {
        const from = new Date(y, 0, 1);
        const to = new Date(y + 1, 0, 1);
        return { from, to, label: `${y}年` };
    }
    // 「去年」
    if (/去年|前年|上年/.test(t)) {
        const from = new Date(y - 1, 0, 1);
        const to = new Date(y, 0, 1);
        return { from, to, label: `${y - 1}年` };
    }
    // 「N年」（純年度）
    const yearMatch = t.match(/^(\d{4})年/);
    if (yearMatch) {
        const yr = parseInt(yearMatch[1]);
        return {
            from: new Date(yr, 0, 1),
            to: new Date(yr + 1, 0, 1),
            label: `${yr}年`,
        };
    }
    // 「N月」（純月份，假設今年；若 N > 當前月則去年）
    const monthMatch = t.match(/^(\d{1,2})月(?![\d/])/);
    if (monthMatch) {
        let mn = parseInt(monthMatch[1]);
        if (mn < 1 || mn > 12) return null;
        let year = y;
        if (mn > m + 1) year = y - 1;
        return {
            from: new Date(year, mn - 1, 1),
            to: new Date(year, mn, 1),
            label: `${year}年${mn}月`,
        };
    }
    return null;
}

// ── 2-1: 整月/年度查詢（不指定廠商或品項）─────────────────────────
// Pattern: 「3月總營收」「本月進貨」「上月支出」「3月記了什麼」「2026年總收入」
export function detectMonthYearQuery(text: string):
    { period: { from: Date; to: Date; label: string }; type?: string } | null {
    const t = normalizeChineseDate(text.trim());
    // 必須有 period 詞 + (查詢動詞 或 類型詞)
    const period = resolvePeriod(t);
    if (!period) return null;

    let type: string | undefined;
    if (/營收|營業額|收入/.test(t)) type = 'revenue';
    else if (/進貨|採購/.test(t)) type = 'purchase';
    else if (/支出|費用/.test(t)) type = 'expense';

    // 必須有查詢意圖（避免吃掉其他輸入）
    const hasIntent = type !== undefined ||
        /記|記錄|紀錄|查|什麼|多少|總計|彙整|統計|匯總/.test(t);
    if (!hasIntent) return null;

    return { period, type };
}

export async function queryByMonthYear(
    period: { from: Date; to: Date; label: string },
    type: string | undefined,
    session: SessionData,
    _ctx: DbContext,
): Promise<string> {
    const lines: string[] = [`📊 ${period.label} 統計`];
    let grandRev = 0, grandPur = 0, grandExp = 0;

    if (!type || type === 'revenue') {
        const revs = await prisma.revenue.findMany({
            where: { tenantId: session.tenantId, date: { gte: period.from, lt: period.to } },
            include: { location: true },
        });
        if (revs.length) {
            const byLoc = new Map<string, number>();
            for (const r of revs) {
                const n = r.location?.name ?? '?';
                byLoc.set(n, (byLoc.get(n) || 0) + r.amount);
                grandRev += r.amount;
            }
            lines.push(`💰 營業額（${revs.length} 筆）：`);
            for (const [n, a] of byLoc) lines.push(`  • ${n}：$${a.toLocaleString()}`);
            lines.push(`  📍 小計：$${grandRev.toLocaleString()}`);
        } else if (type === 'revenue') {
            lines.push('💰 此期間無營業額記錄');
        }
    }

    if (!type || type === 'purchase') {
        const ents = await prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'PURCHASE', date: { gte: period.from, lt: period.to } },
            include: { vendor: true },
        });
        if (ents.length) {
            const byVendor = new Map<string, number>();
            for (const e of ents) {
                const n = e.vendor?.name ?? '?';
                byVendor.set(n, (byVendor.get(n) || 0) + e.totalPrice);
                grandPur += e.totalPrice;
            }
            lines.push(`📦 進貨（${ents.length} 筆）：`);
            for (const [n, a] of byVendor) lines.push(`  • ${n}：$${a.toLocaleString()}`);
            lines.push(`  📍 小計：$${grandPur.toLocaleString()}`);
        } else if (type === 'purchase') {
            lines.push('📦 此期間無進貨記錄');
        }
    }

    if (!type || type === 'expense') {
        const exps = await prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'EXPENSE', date: { gte: period.from, lt: period.to } },
        });
        if (exps.length) {
            const byType = new Map<string, number>();
            for (const e of exps) {
                const t2 = e.expenseType ?? '其他';
                byType.set(t2, (byType.get(t2) || 0) + e.totalPrice);
                grandExp += e.totalPrice;
            }
            lines.push(`💸 支出（${exps.length} 筆）：`);
            for (const [t2, a] of byType) lines.push(`  • ${t2}：$${a.toLocaleString()}`);
            lines.push(`  📍 小計：$${grandExp.toLocaleString()}`);
        } else if (type === 'expense') {
            lines.push('💸 此期間無支出記錄');
        }
    }

    if (!type) {
        const profit = grandRev - grandPur - grandExp;
        lines.push('---');
        lines.push(`📈 毛收入：$${grandRev.toLocaleString()}`);
        lines.push(`📉 總成本：$${(grandPur + grandExp).toLocaleString()}`);
        lines.push(`💵 ${profit >= 0 ? '淨利' : '虧損'}：$${profit.toLocaleString()}`);
    }

    return lines.join('\n');
}

// ── 2-2: 品項月份查詢 ───────────────────────────────────────────
// Pattern: 「3月豬肉進了多少」「豬肉 3月」「查 豬肉 4月」
// 必須在 ctx.items 找到該品項才算 valid（避免和廠商月份查詢衝突）
export function detectItemMonthQuery(
    text: string,
    items: { id: string; name: string }[],
): { itemName: string; itemId: string; period: { from: Date; to: Date; label: string } } | null {
    const t = normalizeChineseDate(text.trim());

    // 先找一個 period
    const period = resolvePeriod(t);
    if (!period) return null;

    // 從 t 中移除月份/年度詞，看剩餘是否包含某個 item name
    const remaining = t
        .replace(/^\d{4}年/, '')
        .replace(/^\d{1,2}月/, '')
        .replace(/(本月|當月|這個月|上月|上個月|今年|去年)/g, '')
        .replace(/(總?營收|總?營業額|總?收入|總?進貨|採購|總?支出|費用|記|記錄|紀錄|查|什麼|多少|彙整|統計|匯總|進了)/g, '')
        .trim();

    if (!remaining) return null;

    // 找最長 match 的品項
    let best: { id: string; name: string } | null = null;
    for (const it of items) {
        if (remaining.includes(it.name) || it.name.includes(remaining)) {
            if (!best || it.name.length > best.name.length) best = it;
        }
    }
    if (!best) return null;

    return { itemName: best.name, itemId: best.id, period };
}

export async function queryByItemMonth(
    itemId: string,
    itemName: string,
    period: { from: Date; to: Date; label: string },
    session: SessionData,
    ctx: DbContext,
): Promise<string> {
    const ents = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            type: 'PURCHASE',
            itemId,
            date: { gte: period.from, lt: period.to },
        },
        include: { vendor: true },
        orderBy: { date: 'asc' },
    });

    if (ents.length === 0) {
        return `📋 ${period.label} ${itemName}：無進貨記錄`;
    }

    const KG_PER_TAIJIN = 0.6;
    const lines: string[] = [`📋 ${period.label} — ${itemName}（${ents.length} 筆）\n`];

    // 按廠商分組
    type V = { count: number; amount: number; totalKg: number; entries: { qty: number; unit: string }[] };
    const byVendor = new Map<string, V>();
    let total = 0, totalKg = 0;
    for (const e of ents) {
        const v = e.vendor?.name ?? '?';
        const cur = byVendor.get(v) || { count: 0, amount: 0, totalKg: 0, entries: [] };
        cur.count += 1;
        cur.amount += e.totalPrice;
        cur.totalKg += e.standardWeight ?? 0;
        if (e.inputQuantity != null) cur.entries.push({ qty: e.inputQuantity, unit: e.inputUnit ?? '' });
        byVendor.set(v, cur);
        total += e.totalPrice;
        totalKg += e.standardWeight ?? 0;
    }

    for (const [v, d] of byVendor) {
        // 數量顯示
        let qtyStr = '';
        if (d.entries.length > 0) {
            const unitCode = d.entries[0].unit;
            if (unitCode === 'jl') {
                let tj = 0, tl = 0;
                for (const e of d.entries) { tj += Math.floor(e.qty / 100); tl += Math.round(e.qty % 100); }
                tj += Math.floor(tl / 16); tl = tl % 16;
                qtyStr = ` ${tj}斤${tl > 0 ? tl + '兩' : ''}`;
            } else {
                const totalQty = d.entries.reduce((s, e) => s + e.qty, 0);
                const unitName = ctx.units.find(u => u.code === unitCode)?.name ?? unitCode;
                qtyStr = ` ${totalQty}${unitName}`;
            }
        }
        const kgStr = d.totalKg > 0 ? `（${d.totalKg.toFixed(2)}kg）` : '';
        lines.push(`  • ${v}${qtyStr}${kgStr} — $${d.amount.toLocaleString()}（${d.count}筆）`);
    }

    lines.push('---');
    if (totalKg > 0) {
        const ppk = total / totalKg;
        const ppt = ppk * KG_PER_TAIJIN;
        lines.push(`📦 總量：${totalKg.toFixed(2)}kg`);
        lines.push(`💰 總額：$${total.toLocaleString()}`);
        lines.push(`💲 平均單價：$${Math.round(ppt)}/台斤 ｜ $${Math.round(ppk)}/公斤`);
    } else {
        lines.push(`💰 總額：$${total.toLocaleString()}`);
    }

    return lines.join('\n');
}

// ── 2-3: 排行查詢 TOP N ─────────────────────────────────────────
// Pattern: 「本月TOP5廠商」「3月最大廠商」「本月熱賣品項」「3月排行」
export function detectRankingQuery(text: string):
    { period: { from: Date; to: Date; label: string }; target: 'vendor' | 'item' | 'location'; topN: number; metric: 'amount' | 'count' } | null {
    const t = normalizeChineseDate(text.trim());

    // 必須含 「TOP/排行/最大/最熱/熱賣/最常」
    if (!/TOP|top|排行|最大|最熱|熱賣|最常|榜/.test(t)) return null;

    const period = resolvePeriod(t) ?? (() => {
        // fallback 本月
        const now = new Date();
        return {
            from: new Date(now.getFullYear(), now.getMonth(), 1),
            to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
            label: `${now.getFullYear()}年${now.getMonth() + 1}月`,
        };
    })();

    let target: 'vendor' | 'item' | 'location' = 'vendor';
    if (/品項|商品|貨品|物品|熱賣|肉|菜/.test(t)) target = 'item';
    else if (/地點|攤位|門市|店面/.test(t)) target = 'location';

    const topMatch = t.match(/TOP\s*(\d+)|top\s*(\d+)|前(\d+)/i);
    const topN = topMatch ? parseInt(topMatch[1] || topMatch[2] || topMatch[3]) : 5;

    return { period, target, topN, metric: 'amount' };
}

export async function queryRanking(
    period: { from: Date; to: Date; label: string },
    target: 'vendor' | 'item' | 'location',
    topN: number,
    session: SessionData,
    _ctx: DbContext,
): Promise<string> {
    const lines: string[] = [`🏆 ${period.label} ${target === 'vendor' ? '廠商' : target === 'item' ? '品項' : '地點'} TOP ${topN}\n`];

    if (target === 'location') {
        const revs = await prisma.revenue.findMany({
            where: { tenantId: session.tenantId, date: { gte: period.from, lt: period.to } },
            include: { location: true },
        });
        const byLoc = new Map<string, { amount: number; count: number }>();
        for (const r of revs) {
            const n = r.location?.name ?? '?';
            const cur = byLoc.get(n) || { amount: 0, count: 0 };
            cur.amount += r.amount; cur.count += 1;
            byLoc.set(n, cur);
        }
        const sorted = Array.from(byLoc.entries()).sort((a, b) => b[1].amount - a[1].amount).slice(0, topN);
        if (sorted.length === 0) return `🏆 ${period.label} 無營業額記錄`;
        sorted.forEach(([n, d], i) => {
            lines.push(`  ${i + 1}. ${n} — $${d.amount.toLocaleString()}（${d.count} 筆）`);
        });
    } else if (target === 'vendor') {
        const ents = await prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'PURCHASE', date: { gte: period.from, lt: period.to } },
            include: { vendor: true },
        });
        const byVendor = new Map<string, { amount: number; count: number }>();
        for (const e of ents) {
            const n = e.vendor?.name ?? '?';
            const cur = byVendor.get(n) || { amount: 0, count: 0 };
            cur.amount += e.totalPrice; cur.count += 1;
            byVendor.set(n, cur);
        }
        const sorted = Array.from(byVendor.entries()).sort((a, b) => b[1].amount - a[1].amount).slice(0, topN);
        if (sorted.length === 0) return `🏆 ${period.label} 無進貨記錄`;
        sorted.forEach(([n, d], i) => {
            lines.push(`  ${i + 1}. ${n} — $${d.amount.toLocaleString()}（${d.count} 筆）`);
        });
    } else {
        // item
        const ents = await prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'PURCHASE', date: { gte: period.from, lt: period.to } },
            include: { item: true },
        });
        const byItem = new Map<string, { amount: number; count: number; kg: number }>();
        for (const e of ents) {
            const n = e.item?.name ?? '?';
            const cur = byItem.get(n) || { amount: 0, count: 0, kg: 0 };
            cur.amount += e.totalPrice; cur.count += 1; cur.kg += e.standardWeight ?? 0;
            byItem.set(n, cur);
        }
        const sorted = Array.from(byItem.entries()).sort((a, b) => b[1].amount - a[1].amount).slice(0, topN);
        if (sorted.length === 0) return `🏆 ${period.label} 無進貨記錄`;
        sorted.forEach(([n, d], i) => {
            const kgStr = d.kg > 0 ? `，${d.kg.toFixed(1)}kg` : '';
            lines.push(`  ${i + 1}. ${n} — $${d.amount.toLocaleString()}（${d.count} 筆${kgStr}）`);
        });
    }

    return lines.join('\n');
}

// ── 2-3b: 支出類型 + 月份查詢 ───────────────────────────────────
// Pattern: 「3月薪資支出」「本月租金」「上月瓦斯費」「3月份薪資支出了多少」
// 必須在 ctx.expenseTypes 找到 label 才算 valid
export function detectExpenseTypeMonthQuery(
    text: string,
    expenseTypes: { id: string; value: string; label: string }[],
): { expenseTypeValue: string; expenseTypeLabel: string; period: { from: Date; to: Date; label: string } } | null {
    const t = normalizeChineseDate(text.trim());

    // 必須有時間 period
    const period = resolvePeriod(t);
    if (!period) return null;

    // 必須有「支出/費用」類型詞 或 包含某個 expense type label
    const hasExpenseHint = /支出|費用/.test(t);
    const remaining = t
        .replace(/^\d{4}年/, '')
        .replace(/^\d{1,2}月份?/, '')
        .replace(/(本月|當月|這個月|上月|上個月|今年|去年)/g, '')
        .trim();

    // remaining 也要清掉月份範圍 pattern
    const cleanedRemaining = remaining
        .replace(/\d{1,2}月(?:到|至|~|－|-)\d{1,2}月份?/g, '')
        .replace(/份/g, '')
        .trim();

    // 從剩餘文字中找 expense type label
    let best: { id: string; value: string; label: string } | null = null;
    const candidate = cleanedRemaining || remaining;
    for (const et of expenseTypes) {
        if (!et.label) continue;
        if (candidate.includes(et.label) || et.label.includes(candidate.replace(/支出|費用|了多少|多少|查|記|什麼/g, '').trim())) {
            if (!best || et.label.length > best.label.length) best = et;
        }
    }

    if (!best) return null;
    if (!hasExpenseHint && best.label.length < 2) return null; // 防止單字 false positive

    return {
        expenseTypeValue: best.value,
        expenseTypeLabel: best.label,
        period,
    };
}

export async function queryByExpenseTypeMonth(
    expenseTypeValue: string,
    expenseTypeLabel: string,
    period: { from: Date; to: Date; label: string },
    session: SessionData,
    _ctx: DbContext,
): Promise<string> {
    const ents = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            type: 'EXPENSE',
            expenseType: expenseTypeValue,
            date: { gte: period.from, lt: period.to },
        },
        orderBy: { date: 'asc' },
    });

    if (ents.length === 0) {
        return `💸 ${period.label} ${expenseTypeLabel}：無支出記錄`;
    }

    const lines: string[] = [`💸 ${period.label} — ${expenseTypeLabel}（${ents.length} 筆）\n`];
    let total = 0;
    for (const e of ents) {
        const d = e.date;
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        const note = e.note ? ` 備註：${e.note}` : '';
        lines.push(`  • ${dateStr} $${e.totalPrice.toLocaleString()}${note}`);
        total += e.totalPrice;
    }
    lines.push('---');
    lines.push(`📍 總計：$${total.toLocaleString()}`);
    return lines.join('\n');
}

// ── 2-3c: 支出類型 + 備註關鍵字查詢 ─────────────────────────────
// Pattern: 「3月份薪資備註小惠累積總共多少」「本月租金備註潮州」
export function detectNoteQuery(
    text: string,
    expenseTypes: { id: string; value: string; label: string }[],
): { expenseTypeValue: string; expenseTypeLabel: string; notePattern: string; period: { from: Date; to: Date; label: string } } | null {
    const t = normalizeChineseDate(text.trim());

    if (!/備註/.test(t)) return null;

    const period = resolvePeriod(t);
    if (!period) return null;

    const cleaned = t
        .replace(/^\d{4}年/, '')
        .replace(/^\d{1,2}月份?/, '')
        .replace(/(本月|當月|這個月|上月|上個月|今年|去年)/g, '')
        .replace(/\d{1,2}月(?:到|至|~|－|-)\d{1,2}月份?/g, '')
        .replace(/份/g, '')
        .trim();

    let best: { id: string; value: string; label: string } | null = null;
    for (const et of expenseTypes) {
        if (!et.label) continue;
        if (cleaned.includes(et.label)) {
            if (!best || et.label.length > best.label.length) best = et;
        }
    }

    if (!best) return null;

    const noteMatch = cleaned.match(/備註[：:]?\s*(.+)/);
    if (!noteMatch) return null;
    const notePattern = noteMatch[1]
        .replace(/累積|總共|了?多少|共多少|\?|？|的?支出|的?記錄|查/g, '')
        .trim();
    if (!notePattern) return null;

    return {
        expenseTypeValue: best.value,
        expenseTypeLabel: best.label,
        notePattern,
        period,
    };
}

export async function queryByNote(
    expenseTypeValue: string,
    expenseTypeLabel: string,
    notePattern: string,
    period: { from: Date; to: Date; label: string },
    session: SessionData,
    _ctx: DbContext,
): Promise<string> {
    const ents = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            type: 'EXPENSE',
            expenseType: expenseTypeValue,
            date: { gte: period.from, lt: period.to },
        },
        orderBy: { date: 'asc' },
    });

    const filtered = ents.filter(e =>
        e.note && e.note.toLowerCase().includes(notePattern.toLowerCase())
    );

    if (filtered.length === 0) {
        return `💸 ${period.label} ${expenseTypeLabel} 備註含「${notePattern}」：無記錄`;
    }

    const lines: string[] = [`💸 ${period.label} — ${expenseTypeLabel}（備註：${notePattern}）（${filtered.length} 筆）\n`];
    let total = 0;
    for (const e of filtered) {
        const d = e.date;
        const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
        lines.push(`  • ${dateStr} $${e.totalPrice.toLocaleString()} — 備註：${e.note}`);
        total += e.totalPrice;
    }
    lines.push('---');
    lines.push(`📍 總計：$${total.toLocaleString()}`);
    return lines.join('\n');
}

// ── 2-4: 同比/環比查詢 ──────────────────────────────────────────
// Pattern: 「本月跟上月比」「3月跟2月比」「對比上月」「環比」
export function detectComparisonQuery(text: string):
    { p1: { from: Date; to: Date; label: string }; p2: { from: Date; to: Date; label: string } } | null {
    const t = normalizeChineseDate(text.trim());

    // 必須有比較詞
    if (!/比|對比|環比|同比/.test(t)) return null;

    // Pattern 1: 「本月跟上月比」「這個月對比上個月」
    if (/(本月|這個月|當月).*?(上月|上個月|前一個月)/.test(t) ||
        /(上月|上個月).*?(本月|這個月|當月)/.test(t) ||
        /環比/.test(t)) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        return {
            p1: { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: `${y}年${m + 1}月` },
            p2: { from: new Date(y, m - 1, 1), to: new Date(y, m, 1), label: `${y}年${m}月` },
        };
    }

    // Pattern 2: 「N月跟M月比」「N月對比M月」
    const dual = t.match(/(\d{1,2})月.*?(?:比|對比).*?(\d{1,2})月|(\d{1,2})月.*?(\d{1,2})月.*?比/);
    if (dual) {
        const m1 = parseInt(dual[1] || dual[3]);
        const m2 = parseInt(dual[2] || dual[4]);
        if (m1 < 1 || m1 > 12 || m2 < 1 || m2 > 12) return null;
        const now = new Date();
        const y = now.getFullYear();
        const cur = now.getMonth() + 1;
        const y1 = m1 > cur ? y - 1 : y;
        const y2 = m2 > cur ? y - 1 : y;
        return {
            p1: { from: new Date(y1, m1 - 1, 1), to: new Date(y1, m1, 1), label: `${y1}年${m1}月` },
            p2: { from: new Date(y2, m2 - 1, 1), to: new Date(y2, m2, 1), label: `${y2}年${m2}月` },
        };
    }

    // Pattern 3: 「同比去年」「同比」
    if (/同比/.test(t)) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        return {
            p1: { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: `${y}年${m + 1}月` },
            p2: { from: new Date(y - 1, m, 1), to: new Date(y - 1, m + 1, 1), label: `${y - 1}年${m + 1}月` },
        };
    }

    return null;
}

async function _periodTotals(period: { from: Date; to: Date }, session: SessionData) {
    const [revs, purs, exps] = await Promise.all([
        prisma.revenue.findMany({
            where: { tenantId: session.tenantId, date: { gte: period.from, lt: period.to } },
        }),
        prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'PURCHASE', date: { gte: period.from, lt: period.to } },
        }),
        prisma.entry.findMany({
            where: { tenantId: session.tenantId, type: 'EXPENSE', date: { gte: period.from, lt: period.to } },
        }),
    ]);
    const rev = revs.reduce((s, r) => s + r.amount, 0);
    const pur = purs.reduce((s, e) => s + e.totalPrice, 0);
    const exp = exps.reduce((s, e) => s + e.totalPrice, 0);
    return { rev, pur, exp, profit: rev - pur - exp };
}

export async function queryComparison(
    p1: { from: Date; to: Date; label: string },
    p2: { from: Date; to: Date; label: string },
    session: SessionData,
    _ctx: DbContext,
): Promise<string> {
    const [t1, t2] = await Promise.all([
        _periodTotals(p1, session),
        _periodTotals(p2, session),
    ]);

    const fmt = (cur: number, prev: number) => {
        if (prev === 0) return cur === 0 ? '—' : `(新增)`;
        const diff = cur - prev;
        const pct = (diff / prev) * 100;
        const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
        return `${arrow} ${diff >= 0 ? '+' : ''}$${diff.toLocaleString()}（${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）`;
    };

    const lines: string[] = [`🔄 ${p1.label} vs ${p2.label}\n`];
    lines.push(`💰 營業額`);
    lines.push(`  ${p1.label}：$${t1.rev.toLocaleString()}`);
    lines.push(`  ${p2.label}：$${t2.rev.toLocaleString()}`);
    lines.push(`  ${fmt(t1.rev, t2.rev)}`);
    lines.push('');
    lines.push(`📦 進貨`);
    lines.push(`  ${p1.label}：$${t1.pur.toLocaleString()}`);
    lines.push(`  ${p2.label}：$${t2.pur.toLocaleString()}`);
    lines.push(`  ${fmt(t1.pur, t2.pur)}`);
    lines.push('');
    lines.push(`💸 支出`);
    lines.push(`  ${p1.label}：$${t1.exp.toLocaleString()}`);
    lines.push(`  ${p2.label}：$${t2.exp.toLocaleString()}`);
    lines.push(`  ${fmt(t1.exp, t2.exp)}`);
    lines.push('');
    lines.push(`💵 淨利`);
    lines.push(`  ${p1.label}：$${t1.profit.toLocaleString()}`);
    lines.push(`  ${p2.label}：$${t2.profit.toLocaleString()}`);
    lines.push(`  ${fmt(t1.profit, t2.profit)}`);

    return lines.join('\n');
}
