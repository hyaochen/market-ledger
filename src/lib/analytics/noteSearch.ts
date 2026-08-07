// 搜尋 #3：備註全文搜尋 — 跨 Entry.note 與 Revenue.note 的關鍵字搜尋

import prisma from '@/lib/prisma';
import { isoDateKeyUTC, resolveRange } from './dateRange';

export interface NoteSearchParams {
    tenantId: string;
    query: string;
    from?: string | null;
    to?: string | null;
    /** 預設 'both' */
    source?: 'entry' | 'revenue' | 'both';
}

export interface NoteSearchHit {
    source: 'entry' | 'revenue';
    id: string;
    date: string;
    note: string;
    amount: number;
    /** Entry 命中時才有：PURCHASE/EXPENSE + 品項或支出類型摘要 */
    context: string;
}

export interface NoteSearchResult {
    range: { from: string; to: string };
    query: string;
    hits: NoteSearchHit[];
}

export async function searchNotes(params: NoteSearchParams): Promise<NoteSearchResult> {
    const { tenantId } = params;
    const query = params.query.trim();
    const source = params.source ?? 'both';
    const range = resolveRange(params.from, params.to, 90);

    if (!query) {
        return { range: { from: range.fromKey, to: range.toKey }, query, hits: [] };
    }

    const hits: NoteSearchHit[] = [];

    if (source === 'entry' || source === 'both') {
        const entries = await prisma.entry.findMany({
            where: {
                tenantId,
                date: { gte: range.gte, lt: range.lt },
                note: { contains: query },
            },
            include: { item: true },
            orderBy: { date: 'desc' },
        });
        for (const e of entries) {
            const context = e.type === 'PURCHASE'
                ? `進貨：${e.item?.name ?? '未知品項'}`
                : `支出：${e.expenseType ?? '未分類'}`;
            hits.push({
                source: 'entry',
                id: e.id,
                date: isoDateKeyUTC(e.date),
                note: e.note ?? '',
                amount: e.totalPrice,
                context,
            });
        }
    }

    if (source === 'revenue' || source === 'both') {
        const revenues = await prisma.revenue.findMany({
            where: {
                tenantId,
                date: { gte: range.gte, lt: range.lt },
                note: { contains: query },
            },
            include: { location: true },
            orderBy: { date: 'desc' },
        });
        for (const r of revenues) {
            hits.push({
                source: 'revenue',
                id: r.id,
                date: isoDateKeyUTC(r.date),
                note: r.note ?? '',
                amount: r.amount,
                context: `營業額：${r.location?.name ?? '未知地點'}`,
            });
        }
    }

    hits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return { range: { from: range.fromKey, to: range.toKey }, query, hits };
}
