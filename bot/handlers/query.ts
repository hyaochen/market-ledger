// 查詢處理（今天記了什麼 / 指定日期）

import prisma from '../../src/lib/prisma';
import type { SessionData, DbContext } from '../types';

// 偵測查詢意圖，回傳目標日期（或 null 代表非查詢）
export function detectQueryDate(text: string): Date | 'recent' | null {
    const t = text.trim();

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
    return detectQueryDate(text) !== null &&
        /記|記錄|記了|記了什麼|紀錄|查|什麼|多少/.test(text);
}

// 格式化日期為 M/D
function fmtDate(d: Date): string {
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 查詢指定日期的記錄並格式化
export async function queryByDate(date: Date, session: SessionData, ctx: DbContext): Promise<string> {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    const entries = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            date: { gte: date, lt: nextDay },
        },
        include: { item: true, vendor: true },
        orderBy: { createdAt: 'asc' },
    });

    if (entries.length === 0) {
        return `📅 ${fmtDate(date)} 尚無記錄`;
    }

    const lines: string[] = [`📅 ${fmtDate(date)} 記錄（${entries.length} 筆）`];
    let purchaseTotal = 0;
    let expenseTotal = 0;

    for (const e of entries) {
        if (e.type === 'PURCHASE') {
            purchaseTotal += e.totalPrice;
            const unitName = e.inputUnit
                ? (ctx.units.find(u => u.code === e.inputUnit)?.name ?? e.inputUnit)
                : '';
            const qty = e.inputQuantity != null ? `${e.inputQuantity}${unitName} ` : '';
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
    lines.push(`進貨：$${purchaseTotal} ｜ 支出：$${expenseTotal} ｜ 合計：$${purchaseTotal + expenseTotal}`);

    return lines.join('\n');
}

// 查詢最近 7 天
export async function queryRecent(session: SessionData, ctx: DbContext): Promise<string> {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const entries = await prisma.entry.findMany({
        where: {
            tenantId: session.tenantId,
            date: { gte: since },
        },
        include: { item: true, vendor: true },
        orderBy: { date: 'asc' },
    });

    if (entries.length === 0) {
        return '📊 最近 7 天尚無記錄';
    }

    // 依日期分組
    const byDate = new Map<string, typeof entries>();
    entries.forEach(e => {
        const key = e.date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key)!.push(e);
    });

    const lines: string[] = [`📊 最近 7 天（${entries.length} 筆）`];
    let grandTotal = 0;

    byDate.forEach((dayEntries, dateKey) => {
        const dayTotal = dayEntries.reduce((s, e) => s + e.totalPrice, 0);
        grandTotal += dayTotal;
        lines.push(`  ${dateKey}（${dayEntries.length} 筆，$${dayTotal}）`);
    });

    lines.push(`---\n總計：$${grandTotal}`);
    return lines.join('\n');
}
