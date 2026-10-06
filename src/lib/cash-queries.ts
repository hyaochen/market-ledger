/**
 * cash 查詢條件的純函式（T-ML-034 Phase C）。
 *
 * 為什麼抽出來：
 * - src/app/actions/cash.ts 是 'use server' 檔，只能 export async function，
 *   裡面的 where 組裝邏輯沒辦法單獨測試。抽成純函式後可以用中文 fixture 鎖住
 *   「既有條件（from / to / mineOnly）的行為完全不變」，再驗證新增的 locationId 篩選。
 * - 新增的 locationId 一律是「可選參數」：沒帶就跟以前一樣，所以所有既有呼叫端
 *   （歷史頁、CSV 匯出）不受影響。
 */

import { parseLocalDate } from "./date";
import { formatTaipeiHHmm } from "./cash-ui";

export type CashCountFilters = {
    from?: string;
    to?: string;
    mineOnly?: boolean;
    /** 只看某個攤位（管理者的攤位篩選）；沒帶 = 全部 */
    locationId?: string;
};

type WhereUser = { id: string; tenantId: string; isAdmin: boolean };

/**
 * listCashCounts 的 where 條件。
 * from / to 的日期解析與 submitCashCount 同一個 parseLocalDate（本機時區的 00:00）。
 */
export function buildCashCountWhere(user: WhereUser, filters?: CashCountFilters): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (filters?.from) {
        const f = parseLocalDate(filters.from);
        if (f) where.date = { ...(where.date as object), gte: f };
    }
    if (filters?.to) {
        const t = parseLocalDate(filters.to);
        if (t) where.date = { ...(where.date as object), lte: t };
    }
    // 員工只看自己；admin 看全部
    if (filters?.mineOnly || !user.isAdmin) {
        where.attendantId = user.id;
    }
    // T-ML-034：攤位篩選（可選參數）
    if (filters?.locationId) {
        where.locationId = filters.locationId;
    }
    return where;
}

/** 分析頁的 where 條件：近 N 天（由呼叫端算好 since）+ 可選的攤位。 */
export function buildStatsWhere(p: { tenantId: string; since: Date; locationId?: string }): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId: p.tenantId, date: { gte: p.since } };
    if (p.locationId) where.locationId = p.locationId;
    return where;
}

// ── 新增清點：今天這個攤位是不是已經提交過 ─────────────────────

/**
 * 找「今天 + 這個攤位」的既有清點用的 where。
 * 日期必須和 submitCashCount 用的 parseLocalDate(date) 完全一致，
 * 否則會查到前一天（時區差一天）或查不到。today 不合法回 null。
 */
export function submissionLookupWhere(p: {
    tenantId: string;
    locationId: string;
    today: string;
}): { date: Date; locationId: string; tenantId: string } | null {
    const date = parseLocalDate(p.today);
    if (!date) return null;
    return { date, locationId: p.locationId, tenantId: p.tenantId };
}

export type SubmissionNotice = {
    id: string;
    /** 台北時間 HH:mm */
    timeLabel: string;
    byName: string;
};

export function toSubmissionNotice(row: {
    id: string;
    handoverTime: Date;
    attendant: { realName: string | null; username: string };
}): SubmissionNotice {
    return {
        id: row.id,
        timeLabel: formatTaipeiHHmm(row.handoverTime),
        byName: row.attendant.realName || row.attendant.username,
    };
}

export function submissionNoticeText(n: SubmissionNotice): string {
    return `今天這個攤位已在 ${n.timeLabel} 由 ${n.byName} 提交過一次。再次提交會覆蓋原本內容。`;
}
