// Jev 品項判斷接進 bot 流程的邏輯（從 index.ts 抽出以便測試，enrich / jev 皆可注入）
// owner 2026-10-09：Jev 高信心採用後，其他欄位本來就符合 auto_save 條件就直接存；
// 其他原本需要確認的原因（重複、缺價格、選廠商、模糊名）照舊確認。
// 不寫 alias：Jev 的錯誤對照一旦寫進 alias 會永久且靜默（alias 命中不顯示對照提示、UI 也無法刪除），
// 而 Jev 每次只需約 0.2 秒，重新判斷成本很低；alias 只在使用者親自確認（既有流程）時學習。

import type { ParsedEntry, DbContext } from './types';
import { getAmbiguousCandidates } from './itemKeywords';
import { jevMatchItem, type JevItemResult } from './jev';

export type EnrichFn = (e: ParsedEntry, ctx: DbContext) => Promise<ParsedEntry>;
export type JevFn = (text: string, name: string, itemNames: string[]) => Promise<JevItemResult>;

export async function applyJevMatch(
    text: string,
    raw: ParsedEntry,
    enriched: ParsedEntry,
    ctx: DbContext,
    enrich: EnrichFn,
    jevFn: JevFn = jevMatchItem,
): Promise<{ entry: ParsedEntry; jev: JevItemResult | null }> {
    try {
        if (enriched.type !== 'PURCHASE' || enriched.itemId) return { entry: enriched, jev: null };
        const name = raw.itemName;
        if (!name || getAmbiguousCandidates(name)) return { entry: enriched, jev: null };
        const jev = await jevFn(text, name, ctx.items.map(it => it.name));
        if (!jev.adopted || !jev.choice) return { entry: enriched, jev };
        const item = ctx.items.find(it => it.name === jev.choice);
        if (!item) return { entry: enriched, jev };
        // 用標準品名重跑 matcher（廠商帶入、重複偵測、缺欄位檢查照舊）。
        // rawInput 補上標準品名，避免 matcher 的「原文找不到比對品名」檢查把 Jev 採用的筆擋成待確認。
        const re = await enrich({ ...raw, itemName: item.name, rawInput: `${raw.rawInput} ${item.name}` }, ctx);
        if (!re.itemId) return { entry: enriched, jev };
        const out: ParsedEntry = { ...re, rawInput: raw.rawInput, _jevMapping: { from: name, to: item.name } };
        if (!out.confident) {
            const reason = `「${name}」→「${item.name}」（AI 判斷）`;
            out.uncertainReason = out.uncertainReason ? `${reason}；${out.uncertainReason}` : reason;
        }
        return { entry: out, jev };
    } catch (err) {
        console.warn('[Jev] fail-open (apply):', err instanceof Error ? err.message : err);
        return { entry: enriched, jev: null };
    }
}
