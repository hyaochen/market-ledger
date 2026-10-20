// 訊息處理裡的 regex 查詢 detector 分派表。
//
// 以前這一串在 bot.on('message') 裡逐個 inline（detect -> logLine -> query -> sendMessage ->
// logQueryBranch），現在每個 detector 一列資料。**順序即優先序**，不可隨意調換：
//   - 日期範圍要排在最前面
//   - 每日營業額排在整月查詢之前：「8月營業額每天」否則會被 detectMonthYearQuery 先接走、只回總數
//   - 備註 > 支出類型 > 品項（備註關鍵字優先，避免被普通支出類型攔截）
//   - 整月/年度最後
// 第一個命中的 detector 就處理並結束（回傳 true），沒有任何命中回傳 false 讓呼叫端繼續。

import { logLine } from '../botLog';
import {
    detectVendorMonthQuery, queryByVendorMonth,
    detectDateRangeQuery, queryByDateRange,
    detectDailyRevenueQuery, queryDailyRevenue,
    detectMonthYearQuery, queryByMonthYear,
    detectItemMonthQuery, queryByItemMonth,
    detectExpenseTypeMonthQuery, queryByExpenseTypeMonth,
    detectNoteQuery, queryByNote,
    detectRankingQuery, queryRanking,
    detectComparisonQuery, queryComparison,
} from './query';
import { logQueryBranch } from './runners';
import type { DbContext, SessionData } from '../types';
import type { Bot } from './botTypes';

export type QueryDetectorCtx = {
    bot: Bot;
    chatId: number;
    messageId: number | undefined;
    telegramId: number;
    text: string;
};

type QueryDetector<M> = {
    /** logQueryBranch 記錄的 detector 名稱 */
    name: string;
    detect: (text: string, qc: DbContext) => M | null;
    /** logLine('QUERY', ...) 的內容 */
    describe: (m: M) => string;
    run: (m: M, session: SessionData, qc: DbContext) => Promise<string>;
};

// 讓每一列保有自己的 match 型別，放進同一個陣列時再抹掉
function detector<M>(d: QueryDetector<M>): QueryDetector<unknown> {
    return d as unknown as QueryDetector<unknown>;
}

export const QUERY_DETECTORS: QueryDetector<unknown>[] = [
    // 日期範圍查詢（例如「3月1號到3月31號屏東攤位的總營收」）
    detector({
        name: 'dateRange',
        detect: (text: string) => detectDateRangeQuery(text),
        describe: (m) => `range=${m.from.toLocaleDateString()}~${m.to.toLocaleDateString()} loc=${m.locationName || 'all'} type=${m.type || 'all'}`,
        run: (m, session, qc) => queryByDateRange(m.from, m.to, m.locationName, m.type, session, qc),
    }),
    // 每日營業額明細（「8月每天營業額」「本月屏東每日」）
    detector({
        name: 'dailyRevenue',
        detect: (text: string, qc: DbContext) => detectDailyRevenueQuery(text, qc.locations),
        describe: (m) => `dailyRevenue ${m.period.label} loc=${m.locationName ?? 'all'}`,
        run: (m, session, qc) => queryDailyRevenue(m.period, m.locationId, m.locationName, session, qc),
    }),
    // 廠商月份查詢（例如「4月 阿明」「查阿明4月進了什麼」）；需要真實廠商清單才能判斷
    detector({
        name: 'vendorMonth',
        detect: (text: string, qc: DbContext) => detectVendorMonthQuery(text, qc.vendors),
        describe: (m) => `vendor=${m.vendorName} month=${m.month}`,
        run: (m, session, qc) => queryByVendorMonth(m.vendorName, m.month, m.year, session, qc),
    }),
    // 同比/環比查詢（例如「本月跟上月比」「3月對比2月」）
    detector({
        name: 'comparison',
        detect: (text: string) => detectComparisonQuery(text),
        describe: (m) => `compare ${m.p1.label} vs ${m.p2.label}`,
        run: (m, session, qc) => queryComparison(m.p1, m.p2, session, qc),
    }),
    // 排行查詢 TOP N（例如「本月TOP5廠商」「3月最熱賣品項」）
    detector({
        name: 'ranking',
        detect: (text: string) => detectRankingQuery(text),
        describe: (m) => `ranking ${m.target} top${m.topN} ${m.period.label}`,
        run: (m, session, qc) => queryRanking(m.period, m.target, m.topN, session, qc),
    }),
    // 備註查詢
    detector({
        name: 'noteQuery',
        detect: (text: string, qc: DbContext) => detectNoteQuery(text, qc.expenseTypes),
        describe: (m) => `expenseType=${m.expenseTypeLabel} note=${m.notePattern} period=${m.period.label}`,
        run: (m, session, qc) => queryByNote(m.expenseTypeValue, m.expenseTypeLabel, m.notePattern, m.period, session, qc),
    }),
    // 支出類型（薪資/租金/瓦斯/...）
    detector({
        name: 'expenseTypeMonth',
        detect: (text: string, qc: DbContext) => detectExpenseTypeMonthQuery(text, qc.expenseTypes),
        describe: (m) => `expenseType=${m.expenseTypeLabel} period=${m.period.label}`,
        run: (m, session, qc) => queryByExpenseTypeMonth(m.expenseTypeValue, m.expenseTypeLabel, m.period, session, qc),
    }),
    // 品項
    detector({
        name: 'itemMonth',
        detect: (text: string, qc: DbContext) => detectItemMonthQuery(text, qc.items),
        describe: (m) => `item=${m.itemName} period=${m.period.label}`,
        run: (m, session, qc) => queryByItemMonth(m.itemId, m.itemName, m.period, session, qc),
    }),
    // 整月/年度查詢（例如「3月總營收」「本月進貨」「2026年總收入」）
    detector({
        name: 'monthYear',
        detect: (text: string) => detectMonthYearQuery(text),
        describe: (m) => `monthYear ${m.period.label} type=${m.type || 'all'}`,
        run: (m, session, qc) => queryByMonthYear(m.period, m.type, session, qc),
    }),
];

export async function runQueryDetectors(
    c: QueryDetectorCtx, session: SessionData, queryCtx: DbContext,
): Promise<boolean> {
    for (const d of QUERY_DETECTORS) {
        const match = d.detect(c.text, queryCtx);
        if (!match) continue;
        logLine('QUERY', c.chatId, d.describe(match));
        const result = await d.run(match, session, queryCtx);
        await c.bot.sendMessage(c.chatId, result);
        logQueryBranch(c.chatId, c.messageId, c.telegramId, session.tenantId, c.text, d.name, result);
        return true;
    }
    return false;
}
