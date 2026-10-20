// 查詢選單 v2 的 callback（callback_data 以 "q:" 開頭）。
// callback_data 格式說明見 menu.ts。

import {
    runQuery, expenseGroups, periodFromCode,
    METRIC_LABEL,
    type QuerySpec, type Metric, type GroupBy,
} from './querySpec';
import {
    MENU_ROOT_TEXT, buildRootMenu, buildMetricMenu, buildPeriodMenu, buildPickMonthMenu, buildPickDateMenu,
    buildGroupByKeyboard, buildDayResultKeyboard, buildExpenseDrillKeyboard, previousPeriodCode, salaryValues,
} from './menu';
import { logLine } from '../botLog';
import type { CbCtx } from './botTypes';

export async function handleMenuCallback(c: CbCtx): Promise<void> {
    const { bot, query, chatId, data, session, ctx } = c;
    const parts = data.split(':');
    const kind = parts[1];
    const msgId = query.message?.message_id;

    // 導覽：原地換頁（失敗就發新訊息）
    const nav = async (text: string, markup: unknown) => {
        try {
            await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: markup as never });
        } catch {
            await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: markup as never });
        }
    };

    if (kind === 'root') { await nav(MENU_ROOT_TEXT, buildRootMenu()); return; }
    if (kind === 's1') { await nav('*進階查詢* — 第 1 步：查什麼？', buildMetricMenu()); return; }
    if (kind === 'm') {
        const metric = parts[2] as Metric;
        await nav(`*${METRIC_LABEL[metric]}* — 第 2 步：哪段時間？`, buildPeriodMenu(metric));
        return;
    }
    if (kind === 'pm') { await nav('挑月份', buildPickMonthMenu(parts[2] as Metric)); return; }
    if (kind === 'pd') { await nav('挑日期（近 7 天）', buildPickDateMenu()); return; }
    if (kind === 'p') {
        const metric = parts[2] as Metric;
        const pcode = parts[3];
        const period = periodFromCode(pcode);
        if (!period) { await bot.sendMessage(chatId, '期間代碼不對，請重開 /menu。'); return; }
        await nav(`*${period.label} · ${METRIC_LABEL[metric]}* — 第 3 步：怎麼看？`, buildGroupByKeyboard(metric, pcode));
        return;
    }

    // 執行類：結果一律「新訊息 + 掛鍵盤」
    let result = '';
    let markup: unknown = buildRootMenu();
    try {
        if (kind === 'r' || kind === 'c') {
            const metric = parts[2] as Metric;
            const pcode = parts[3];
            const period = periodFromCode(pcode);
            if (!period) throw new Error(`bad pcode ${pcode}`);

            if (kind === 'c') {
                const prev = periodFromCode(previousPeriodCode(pcode))!;
                result = await runQuery({ metric, period, compareTo: prev }, session, ctx);
                markup = buildGroupByKeyboard(metric, pcode, 'compare');
            } else {
                const g = parts[4];
                const spec: QuerySpec = g === 'list'
                    ? { metric, period, agg: 'list' }
                    : { metric, period, groupBy: g as GroupBy };
                result = await runQuery(spec, session, ctx);

                if (metric === 'entries') {
                    const off = Number(pcode.replace(/^d/, ''));
                    markup = /^d\d+$/.test(pcode) ? buildDayResultKeyboard(off) : buildGroupByKeyboard(metric, pcode, g);
                } else if (metric === 'expense' && (g === 'expenseType' || g === 'note')) {
                    const groups = await expenseGroups(spec, g, session, ctx);
                    markup = buildExpenseDrillKeyboard(metric, pcode, g, groups, g === 'expenseType' ? 'type' : 'note');
                } else {
                    markup = buildGroupByKeyboard(metric, pcode, g);
                }
            }
        } else if (kind === 'sal') {
            // 捷徑：薪資依人
            const pcode = parts[2];
            const period = periodFromCode(pcode)!;
            const spec: QuerySpec = { metric: 'expense', period, groupBy: 'note', filters: { expenseTypeValues: salaryValues(ctx) } };
            result = await runQuery(spec, session, ctx);
            const groups = await expenseGroups(spec, 'note', session, ctx);
            markup = buildExpenseDrillKeyboard('expense', pcode, 'note', groups, 'salary');
        } else if (kind === 'x') {
            // 下鑽：某支出類型逐筆
            const pcode = parts[2];
            const values = (parts.slice(3).join(':')).split(',').filter(Boolean);
            const period = periodFromCode(pcode)!;
            result = await runQuery({ metric: 'expense', period, agg: 'list', filters: { expenseTypeValues: values } }, session, ctx);
            markup = buildGroupByKeyboard('expense', pcode, 'expenseType');
        } else if (kind === 'n' || kind === 'sn') {
            // 下鑽：某人（備註）逐筆；sn = 限薪資
            const pcode = parts[2];
            const note = parts.slice(3).join(':');
            const period = periodFromCode(pcode)!;
            const filters: QuerySpec['filters'] = { notePattern: note };
            if (kind === 'sn') filters.expenseTypeValues = salaryValues(ctx);
            result = await runQuery({ metric: 'expense', period, agg: 'list', filters }, session, ctx);
            markup = buildGroupByKeyboard('expense', pcode, 'note');
        } else {
            result = '這個按鈕我不認得，請重開 /menu。';
        }
    } catch (e) {
        console.error('[Menu v2 error]', data, e);
        result = '【注意】查詢時發生錯誤，請再試一次或改用打字查詢。';
    }

    logLine('MENU', chatId, data);
    await bot.sendMessage(chatId, result, { reply_markup: markup as never });
    return;
}

