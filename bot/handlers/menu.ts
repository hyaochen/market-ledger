// 查詢選單 v2 鍵盤與文字（按鈕式）

import { periodFromOffset, periodForDay, GROUPBY_LABEL, GROUPBYS_FOR, type Metric } from './querySpec';
import type { DbContext } from '../types';

// ── 查詢選單 v2（按鈕式）────────────────────────────────────────
// 設計：vault projects/market-ledger/design/2026-09-03-query-system-v2
//
// 兩層：捷徑列（依 log 真實頻率）+ 進階查詢三步組合器（指標 → 期間 → 切法）。
// 三步全部走同一個 QuerySpec 引擎（handlers/querySpec.ts），不用一顆按鈕寫一個 handler。
//
// owner 2026-09-03 的核心要求：「得出答案後，按鈕選單還是要在下面，不用往上滑」。
// 做法：**每則結果訊息本身就掛著按鈕**（換切法／換期間／換指標／回選單），
// 而不是另發一則選單。最新那則永遠有按鈕。導覽（換頁）才用原地編輯。
//
// callback_data 上限 64 bytes，且 ChatState 不存草稿 —— 每顆按鈕自帶完整參數：
//   q:root                         首頁
//   q:s1                           步驟1：選指標
//   q:m:<metric>                   → 步驟2：選期間
//   q:p:<metric>:<pcode>           → 步驟3：選切法
//   q:r:<metric>:<pcode>:<groupBy> 執行（結果掛切法鍵盤）
//   q:c:<metric>:<pcode>           與上一期比較
//   q:pd / q:pm:<metric>           挑日期（近7天）/ 挑月份（近6個月）
//   q:x:<pcode>:<values>           支出某類型逐筆（下鑽）
//   q:n:<pcode>:<note>             支出某備註（人）逐筆（下鑽）
//   q:sal:<pcode>                  薪資依人（捷徑）
//   q:sn:<pcode>:<note>            某人薪資逐筆（下鑽）
// pcode：d0 今天 d1 昨天 d2 前天 w0 本週 w1 上週 m0 本月 m1 上月 … y0 今年 y1 去年

export type Btn = { text: string; callback_data: string };
export const CB_LIMIT = 64;
export function cbOk(cb: string): boolean { return Buffer.byteLength(cb, 'utf8') <= CB_LIMIT; }

export const MENU_ROOT_TEXT = '*想查什麼？*\n_也可以直接打字，例如「8月薪水」「8月每天營業額」_';

export function buildRootMenu() {
    return {
        inline_keyboard: [
            [
                { text: '今天記了什麼', callback_data: 'q:r:entries:d0:none' },
                { text: '昨天記了什麼', callback_data: 'q:r:entries:d1:none' },
            ],
            [{ text: '挑日期…', callback_data: 'q:pd' }],
            [
                { text: '本月薪資·依人', callback_data: 'q:sal:m0' },
                { text: '本月支出', callback_data: 'q:r:expense:m0:expenseType' },
            ],
            [
                { text: '本月每日營業額', callback_data: 'q:r:revenue:m0:day' },
                { text: '本月進貨', callback_data: 'q:r:purchase:m0:vendor' },
            ],
            [{ text: '進階查詢（自己組合）', callback_data: 'q:s1' }],
        ],
    };
}

export const METRIC_BTNS: Btn[] = [
    { text: '營業額', callback_data: 'q:m:revenue' },
    { text: '進貨', callback_data: 'q:m:purchase' },
    { text: '支出', callback_data: 'q:m:expense' },
    { text: '淨利', callback_data: 'q:m:profit' },
    { text: '全部記錄', callback_data: 'q:m:entries' },
];

export function buildMetricMenu() {
    return {
        inline_keyboard: [
            [METRIC_BTNS[0], METRIC_BTNS[1]],
            [METRIC_BTNS[2], METRIC_BTNS[3]],
            [METRIC_BTNS[4]],
            [{ text: '選單', callback_data: 'q:root' }],
        ],
    };
}

export const PERIOD_BTNS: [string, string][] = [
    ['今天', 'd0'], ['昨天', 'd1'], ['本週', 'w0'], ['上週', 'w1'],
    ['本月', 'm0'], ['上月', 'm1'], ['今年', 'y0'], ['去年', 'y1'],
];

export function buildPeriodMenu(metric: Metric) {
    const rows: Btn[][] = [];
    for (let i = 0; i < PERIOD_BTNS.length; i += 4) {
        rows.push(PERIOD_BTNS.slice(i, i + 4).map(([t, c]) => ({ text: t, callback_data: `q:p:${metric}:${c}` })));
    }
    rows.push([{ text: '挑月份…', callback_data: `q:pm:${metric}` }]);
    rows.push([
        { text: '換指標', callback_data: 'q:s1' },
        { text: '選單', callback_data: 'q:root' },
    ]);
    return { inline_keyboard: rows };
}

export function buildPickMonthMenu(metric: Metric) {
    const rows: Btn[][] = [];
    const btns: Btn[] = [];
    for (let off = 0; off < 6; off++) {
        btns.push({ text: periodFromOffset(off).label.replace(/^\d{4}年/, ''), callback_data: `q:p:${metric}:m${off}` });
    }
    rows.push(btns.slice(0, 3), btns.slice(3, 6));
    rows.push([{ text: '返回', callback_data: `q:m:${metric}` }, { text: '選單', callback_data: 'q:root' }]);
    return { inline_keyboard: rows };
}

export function buildPickDateMenu() {
    const rows: Btn[][] = [];
    const btns: Btn[] = [];
    for (let off = 0; off < 7; off++) {
        const p = periodForDay(off);
        const label = off < 3 ? p.label.replace(/（.*）/, '') : `${p.from.getMonth() + 1}/${p.from.getDate()} ${['日','一','二','三','四','五','六'][p.from.getDay()]}`;
        btns.push({ text: label, callback_data: `q:r:entries:d${off}:none` });
    }
    rows.push(btns.slice(0, 3), btns.slice(3, 7));
    rows.push([{ text: '選單', callback_data: 'q:root' }]);
    return { inline_keyboard: rows };
}

/** 步驟3：切法（依指標動態）。同時也是「結果訊息下方」的鍵盤，active 那顆標 ● */
export function buildGroupByKeyboard(metric: Metric, pcode: string, active?: string) {
    const rows: Btn[][] = [];
    const opts = GROUPBYS_FOR[metric];
    const btns: Btn[] = opts.map(g => ({
        text: `${active === g ? '● ' : ''}${GROUPBY_LABEL[g]}`,
        callback_data: `q:r:${metric}:${pcode}:${g}`,
    }));
    if (metric !== 'entries') {
        btns.push({ text: `${active === 'compare' ? '● ' : ''}vs 上期`, callback_data: `q:c:${metric}:${pcode}` });
    }
    if (metric !== 'entries' && metric !== 'profit') {
        btns.push({ text: `${active === 'list' ? '● ' : ''}逐筆明細`, callback_data: `q:r:${metric}:${pcode}:list` });
    }
    for (let i = 0; i < btns.length; i += 3) rows.push(btns.slice(i, i + 3));
    rows.push([
        { text: '換期間', callback_data: `q:m:${metric}` },
        { text: '換指標', callback_data: 'q:s1' },
        { text: '選單', callback_data: 'q:root' },
    ]);
    return { inline_keyboard: rows };
}

/** 單日「記了什麼」結果的鍵盤：直接換天，不用回選單 */
export function buildDayResultKeyboard(activeOff: number) {
    const mk = (off: number, t: string): Btn => ({ text: `${activeOff === off ? '● ' : ''}${t}`, callback_data: `q:r:entries:d${off}:none` });
    return {
        inline_keyboard: [
            [mk(0, '今天'), mk(1, '昨天'), mk(2, '前天')],
            [{ text: '挑日期…', callback_data: 'q:pd' }, { text: '選單', callback_data: 'q:root' }],
        ],
    };
}

/**
 * 支出結果的下鑽鍵盤：依類型 → 每個類型一顆按鈕點進逐筆；依人 → 每個人一顆。
 * 這是媽媽第三高頻的問題（「薪資備註小惠累積多少」），做成一鍵。
 */
export function buildExpenseDrillKeyboard(
    metric: Metric, pcode: string, active: string,
    groups: { key: string; sum: number; values: string[] }[],
    kind: 'type' | 'note' | 'salary',
) {
    const base = buildGroupByKeyboard(metric, pcode, active);
    const drill: Btn[] = [];
    for (const g of groups.slice(0, 12)) {
        let cb = '';
        if (kind === 'type') cb = `q:x:${pcode}:${g.values.join(',')}`;
        else if (kind === 'note') cb = `q:n:${pcode}:${g.key}`;
        else cb = `q:sn:${pcode}:${g.key}`;
        if (!cbOk(cb) || g.key.startsWith('（')) continue;   // 太長或「（無備註）」不做按鈕
        drill.push({ text: `${g.key} $${Math.round(Math.abs(g.sum)).toLocaleString()}`, callback_data: cb });
    }
    const rows: Btn[][] = [];
    for (let i = 0; i < drill.length; i += 2) rows.push(drill.slice(i, i + 2));
    return { inline_keyboard: [...rows, ...base.inline_keyboard] };
}

/** 從 pcode 算「上一期」：m0→m1、d1→d2、w0→w1、y0→y1 */
export function previousPeriodCode(pcode: string): string {
    const m = pcode.match(/^([dwmy])(\d+)$/);
    return m ? `${m[1]}${Number(m[2]) + 1}` : pcode;
}

export function salaryValues(ctx: DbContext): string[] {
    return ctx.expenseTypes.filter(x => /薪資|薪水/.test(x.label)).map(x => x.value);
}
