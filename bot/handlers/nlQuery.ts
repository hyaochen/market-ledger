// ── 自然語言查詢：問句 → QuerySpec（Phase 4）──────────────────────
//
// 設計：vault projects/market-ledger/design/2026-09-03-query-system-v2 §2
//
// LLM 在這裡只做一件事：把中文問句翻成封閉的 JSON 草稿（名稱，不是 id）。
// 它永遠碰不到 DB。草稿要過 zod 驗證、期間合理性檢查、實體 fuzzy 對照到 ctx，
// 任何一關過不了就回頭問使用者（附候選），**不猜**。
// 通過的 spec 交給 handlers/querySpec 的 runQuery —— 跟按鈕走同一個引擎。
//
// 為什麼不是 text-to-SQL：2026-08-30 ollama 憑空編出一筆營收的教訓。
// 封閉 schema 可驗證、可拒絕、可在回覆裡覆述「我理解成什麼」。

import { z } from 'zod';
import type { DbContext } from '../types';
import { fuzzyScore } from '../../src/lib/analytics/textMatch';
import { callLLMRaw, type ParseDiagnostics } from '../parser';
import type { QuerySpec, Metric, GroupBy, Period } from './querySpec';
import { METRIC_LABEL, GROUPBY_LABEL } from './querySpec';

// ── 閘門：這句像不像「在問問題」──────────────────────────────────
// 只有像問句才會花一次 LLM（p50 4s）。記帳一律不進來 —— 記帳有金額/數量，
// 去掉日期、月份、TOP N 之後還剩數字的，就當記帳。
const QUERY_HINT_RE = /多少|什麼|啥|哪|誰|幾|比|差|排行|最|平均|總共|合計|累積|明細|列出|每天|每日|每月|每週|趨勢|統計|報表|查|情況|狀況|top\s*\d+|前\s*\d+\s*名|[?？]\s*$/i;

export function isQueryLike(text: string): boolean {
    const t = text.trim();
    if (!t || t.startsWith('/')) return false;
    if (!QUERY_HINT_RE.test(t)) return false;
    const stripped = t
        .replace(/top\s*\d+/ig, ' ')
        .replace(/前\s*\d+\s*名?/g, ' ')
        .replace(/\d{1,2}[/月]\d{1,2}[日號]?/g, ' ')
        .replace(/\d{1,2}月/g, ' ')
        .replace(/\d{4}\s*年/g, ' ')
        .replace(/[一二三四五六七八九十]+月/g, ' ');
    return !/\d/.test(stripped);
}

// ── LLM 草稿 schema ──────────────────────────────────────────────
const METRICS = ['revenue', 'purchase', 'expense', 'profit', 'entries'] as const;
const GROUPBYS = ['none', 'day', 'month', 'location', 'vendor', 'item', 'category', 'expenseType', 'note'] as const;

const PeriodDraft = z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
});

const DraftSchema = z.object({
    clarify: z.string().optional(),
    metric: z.enum(METRICS).optional(),
    period: PeriodDraft.optional(),
    groupBy: z.enum(GROUPBYS).optional(),
    agg: z.enum(['sum', 'list']).optional(),
    topN: z.number().int().min(1).max(50).optional(),
    compareTo: PeriodDraft.optional(),
    filters: z.object({
        location: z.string().optional(),
        vendor: z.string().optional(),
        item: z.string().optional(),
        expenseType: z.string().optional(),
        note: z.string().optional(),
    }).optional(),
});
export type NlDraft = z.infer<typeof DraftSchema>;

// ── Prompt ──────────────────────────────────────────────────────
export function buildNlSystemPrompt(ctx: DbContext, todayIso: string): string {
    const locs = ctx.locations.map(l => l.name).join('、');
    const vendors = ctx.vendors.map(v => v.name).join('、');
    const expLabels = [...new Set(ctx.expenseTypes.map(e => e.label))].join('、');
    return `你是記帳系統的查詢翻譯器。把使用者的中文問句翻成一個 JSON 物件，只輸出 JSON，不要任何說明文字。
今天是 ${todayIso}。

可用攤位：${locs}
可用廠商：${vendors}
可用支出類型：${expLabels}
品項很多不列出，filters.item 直接填使用者說的品項名即可，系統會自己比對。

JSON 欄位：
- metric: "revenue"(營業額/營收/收入/賣多少) | "purchase"(進貨/買了/叫貨) | "expense"(支出/花費/薪資/租金等費用) | "profit"(淨利/賺多少/利潤) | "entries"(記了什麼/全部記錄)
- period: {"from":"YYYY-MM-DD","to":"YYYY-MM-DD","label":"人看的標籤"}。to 是「不含」的隔天。沒說期間 → 本月。
  「8月」→ 8/1 到 9/1；「上半年」→ 1/1 到 7/1；「上週」→ 上週一到本週一；「昨天」→ 昨天到今天。
- groupBy: "none" | "day"(每天/每日) | "month"(每月) | "location"(依攤位) | "vendor"(依廠商) | "item"(依品項) | "category"(依分類) | "expenseType"(依支出類型) | "note"(依備註/依人：薪資的備註就是員工名)
- agg: "sum"(問多少/合計) | "list"(記了什麼/明細/列出/每次)
- topN: 問「哪個最多」「前幾名」「排行」時填數字（預設 5；「哪天賺最多」→ groupBy day + topN 1）
- compareTo: 問「A 跟 B 比」「差多少」時，period 放後面那期、compareTo 放前面那期
- filters: {"location":"屏東","vendor":"海豐","item":"頭皮","expenseType":"薪資","note":"阿秀"} 只填有提到的
  「XX的薪水」「薪資備註XX」→ expenseType 薪資 + note XX。「每個人的薪水」→ expenseType 薪資 + groupBy note。
  同義詞：薪水/工資=薪資、房租=租金。

判斷不出使用者要什麼 → 只輸出 {"clarify":"一句話問清楚，並列出可選項"}。不要猜。

範例：
問：8月每個人的薪水各多少
答：{"metric":"expense","period":{"from":"2026-08-01","to":"2026-09-01","label":"2026年8月"},"groupBy":"note","filters":{"expenseType":"薪資"}}
問：8月哪天賺最多
答：{"metric":"revenue","period":{"from":"2026-08-01","to":"2026-09-01","label":"2026年8月"},"groupBy":"day","topN":1}
問：7月跟8月屏東的營業額差多少
答：{"metric":"revenue","period":{"from":"2026-08-01","to":"2026-09-01","label":"2026年8月"},"compareTo":{"from":"2026-07-01","to":"2026-08-01","label":"2026年7月"},"filters":{"location":"屏東"}}
問：海豐上個月每次進貨明細
答：{"metric":"purchase","period":{"from":"2026-08-01","to":"2026-09-01","label":"2026年8月"},"agg":"list","filters":{"vendor":"海豐"}}`;
}

// ── 解析 LLM 回覆 ─────────────────────────────────────────────────
/** 容忍 code fence / 前後贅字，抓第一個 {...} */
export function parseNlResponse(content: string): NlDraft | null {
    const trimmed = content.trim();
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : trimmed;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let obj: unknown;
    try { obj = JSON.parse(body.slice(start, end + 1)); } catch { return null; }
    const r = DraftSchema.safeParse(obj);
    if (!r.success) {
        console.warn('[NLQ] draft rejected by schema:', r.error.issues.slice(0, 3));
        return null;
    }
    return r.data;
}

// ── 驗證 + 實體解析 ──────────────────────────────────────────────
export type NlOutcome =
    | { kind: 'spec'; spec: QuerySpec; restate: string }
    | { kind: 'clarify'; question: string };

const MAX_SPAN_DAYS = 400;

function parseIsoDate(s: string): Date | null {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
}

function toPeriod(p: { from: string; to: string; label?: string }): Period | string {
    const from = parseIsoDate(p.from), to = parseIsoDate(p.to);
    if (!from || !to) return '日期格式看不懂';
    if (to <= from) return '期間的結束早於開始';
    const spanDays = (to.getTime() - from.getTime()) / 86400000;
    if (spanDays > MAX_SPAN_DAYS) return `期間太長（${Math.round(spanDays)} 天），請縮到一年內`;
    const now = new Date();
    if (from.getFullYear() < now.getFullYear() - 2) return '期間太早，資料只有近兩年';
    let label = p.label;
    if (!label) {
        const wholeMonth = from.getDate() === 1 && to.getDate() === 1 && spanDays >= 28 && spanDays <= 31;
        label = wholeMonth
            ? `${from.getFullYear()}年${from.getMonth() + 1}月`
            : `${from.getMonth() + 1}/${from.getDate()}~${to.getMonth() + 1}/${to.getDate() - 1 || to.getDate()}`;
    }
    return { from, to, label };
}

function bestMatch<T extends { name: string }>(q: string, list: T[]): { item: T; score: number } | null {
    let best: { item: T; score: number } | null = null;
    for (const it of list) {
        const s = Math.max(fuzzyScore(q, it.name), fuzzyScore(q, it.name.replace(/攤位|門市|店/g, '')));
        if (!best || s > best.score) best = { item: it, score: s };
    }
    return best;
}

const EXPENSE_SYNONYMS: [RegExp, string][] = [[/薪水|工資|薪餉|薪俸/g, '薪資'], [/房租/g, '租金']];

export function validateAndResolve(draft: NlDraft, ctx: DbContext): NlOutcome {
    if (draft.clarify) return { kind: 'clarify', question: draft.clarify };
    if (!draft.metric) return { kind: 'clarify', question: '你想查營業額、進貨、支出、淨利，還是某天記了什麼？' };

    const period = draft.period ? toPeriod(draft.period) : toPeriod(defaultMonth());
    if (typeof period === 'string') return { kind: 'clarify', question: `${period}，可以說「8月」「上週」「8/1到8/15」這類期間。` };

    let compareTo: Period | undefined;
    if (draft.compareTo) {
        const c = toPeriod(draft.compareTo);
        if (typeof c === 'string') return { kind: 'clarify', question: `比較的另一期${c}。` };
        compareTo = c;
    }

    const filters: NonNullable<QuerySpec['filters']> = {};
    const restateParts: string[] = [period.label, METRIC_LABEL[draft.metric as Metric]];
    const f = draft.filters ?? {};

    if (f.location) {
        const m = bestMatch(f.location, ctx.locations);
        if (!m || m.score < 0.5) {
            return { kind: 'clarify', question: `找不到攤位「${f.location}」，目前有：${ctx.locations.map(l => l.name).join('、')}` };
        }
        filters.locationId = m.item.id;
        restateParts.push(m.item.name);
    }
    if (f.vendor) {
        const m = bestMatch(f.vendor, ctx.vendors);
        if (!m || m.score < 0.85) {
            const cands = ctx.vendors
                .map(v => ({ v, s: fuzzyScore(f.vendor!, v.name) }))
                .sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.v.name);
            return { kind: 'clarify', question: `找不到廠商「${f.vendor}」。你是指：${cands.join('、')}？` };
        }
        filters.vendorId = m.item.id;
        restateParts.push(m.item.name);
    }
    if (f.item) {
        const m = bestMatch(f.item, ctx.items);
        if (!m || m.score < 0.85) {
            const cands = ctx.items
                .map(i => ({ i, s: fuzzyScore(f.item!, i.name) }))
                .sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.i.name);
            return { kind: 'clarify', question: `找不到品項「${f.item}」。你是指：${cands.join('、')}？` };
        }
        filters.itemId = m.item.id;
        restateParts.push(m.item.name);
    }
    if (f.expenseType) {
        let q = f.expenseType;
        for (const [re, canon] of EXPENSE_SYNONYMS) q = q.replace(re, canon);
        const labels = [...new Set(ctx.expenseTypes.map(e => e.label))];
        let label = labels.find(l => l === q) ?? labels.find(l => l.includes(q) || q.includes(l));
        if (!label) {
            const scored = labels.map(l => ({ l, s: fuzzyScore(q, l) })).sort((a, b) => b.s - a.s);
            if (scored[0] && scored[0].s >= 0.6) label = scored[0].l;
        }
        if (!label) {
            return { kind: 'clarify', question: `找不到支出類型「${f.expenseType}」，目前有：${labels.join('、')}` };
        }
        filters.expenseTypeValues = ctx.expenseTypes.filter(e => e.label === label).map(e => e.value);
        restateParts.push(label);
    }
    if (f.note) {
        filters.notePattern = f.note.trim();
        restateParts.push(`備註「${filters.notePattern}」`);
    }

    // 指標與篩選的一致性：拿廠商/品項篩選卻問營業額之類的，直接糾正而不是靜默丟掉篩選
    const metric = draft.metric as Metric;
    if ((filters.vendorId || filters.itemId) && metric !== 'purchase' && metric !== 'entries') {
        return { kind: 'clarify', question: `廠商／品項只跟「進貨」有關，你是要查進貨嗎？` };
    }
    if ((filters.expenseTypeValues || filters.notePattern) && metric !== 'expense' && metric !== 'entries') {
        return { kind: 'clarify', question: `支出類型／備註只跟「支出」有關，你是要查支出嗎？` };
    }

    const groupBy = (draft.groupBy ?? 'none') as GroupBy;
    const agg = draft.agg;
    if (agg === 'list') restateParts.push('逐筆明細');
    else if (groupBy !== 'none') restateParts.push(GROUPBY_LABEL[groupBy]);
    if (draft.topN) restateParts.push(`前 ${draft.topN}`);
    if (compareTo) restateParts.push(`vs ${compareTo.label}`);

    const spec: QuerySpec = {
        metric, period,
        groupBy: agg === 'list' ? undefined : groupBy,
        agg,
        topN: draft.topN,
        compareTo,
        filters: Object.keys(filters).length ? filters : undefined,
    };
    return { kind: 'spec', spec, restate: restateParts.filter(Boolean).join(' · ') };
}

function defaultMonth(): { from: string; to: string; label: string } {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from: iso(from), to: iso(to), label: `${from.getFullYear()}年${from.getMonth() + 1}月` };
}

// ── 入口 ────────────────────────────────────────────────────────
export type NlTranslateResult =
    | { kind: 'spec'; spec: QuerySpec; restate: string; provider: 'claude' | 'ollama' }
    | { kind: 'clarify'; question: string; provider: 'claude' | 'ollama' }
    | { kind: 'unavailable'; reason: string };

export async function translateQuestion(text: string, ctx: DbContext, diag?: ParseDiagnostics): Promise<NlTranslateResult> {
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const system = buildNlSystemPrompt(ctx, todayIso);
    const raw = await callLLMRaw(system, text, diag);
    if (!raw) return { kind: 'unavailable', reason: 'llm-unreachable' };
    console.log(`[NLQ] raw (${raw.provider}):`, raw.content.slice(0, 300).replace(/\s+/g, ' '));
    const draft = parseNlResponse(raw.content);
    if (!draft) return { kind: 'unavailable', reason: 'unparseable' };
    const out = validateAndResolve(draft, ctx);
    return out.kind === 'spec'
        ? { kind: 'spec', spec: out.spec, restate: out.restate, provider: raw.provider }
        : { kind: 'clarify', question: out.question, provider: raw.provider };
}
