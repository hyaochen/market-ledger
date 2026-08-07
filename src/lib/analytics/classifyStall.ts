// 分類 #10：攤位自動判斷 — 從 note、廠商、品項、歷史模式推測該筆進貨/支出屬於哪個攤位。
// 推不出來就回 unknown 並附信心度，不准硬猜（owner spec 明講的紅線）。
//
// 🔴 誠實面對限制（實測結果，見 learning brief）：
// 這一層對「進貨」幾乎沒用武之地 —— 真實資料裡 158 筆 7 月進貨只有 1 筆有備註，
// 全租戶目前只有 3 筆 PURCHASE 有備註（"測試"/"次尾"/"正義"），沒有一筆備註內容
// 對得到「中山/潮州」，vendor-history / item-history 這兩層目前幾乎永遠會落到
// insufficient-data。對「支出」（清潔費/洗攤/薪資/水電費）就準很多，因為那些類型
// 的備註習慣本來就會寫攤位。這不是演算法沒做好，是資料本身目前就是這樣 —— 批 2/3
// 如果要在 bot/網頁 UI 用這支函式幫使用者省輸入，加了攤位備註的比例才會提升，
// 這個分類器的效用才會隨資料變好而變好。

import prisma from '@/lib/prisma';
import { inferStallFromNote, type StallCode } from './stallInference';

export interface StallSuggestion {
    stall: StallCode | 'unknown';
    confidence: number;
    method: 'note-alias' | 'note-typo-alias' | 'vendor-history' | 'item-history' | 'insufficient-data';
    detail: string;
}

export interface ClassifyStallInput {
    tenantId: string;
    note?: string | null;
    vendorId?: string | null;
    itemId?: string | null;
    /** 排除自己（用於重新分類既有 Entry，避免拿自己當歷史證據） */
    excludeEntryId?: string;
}

const VENDOR_MIN_SAMPLES = 3;
const VENDOR_CONFIDENCE_THRESHOLD = 0.8;
const ITEM_MIN_SAMPLES = 5;
const ITEM_CONFIDENCE_THRESHOLD = 0.85;

async function historyStallDistribution(
    tenantId: string,
    where: { vendorId?: string; itemId?: string },
    excludeEntryId?: string
): Promise<Map<StallCode, number>> {
    const entries = await prisma.entry.findMany({
        where: {
            tenantId,
            note: { not: null },
            ...where,
            ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
        },
        select: { note: true },
        take: 500, // 防禦性上限，避免超大租戶掃全表
    });

    const dist = new Map<StallCode, number>();
    for (const e of entries) {
        const inference = inferStallFromNote(e.note);
        if (inference.stall === 'unknown') continue;
        dist.set(inference.stall, (dist.get(inference.stall) ?? 0) + 1);
    }
    return dist;
}

function pickDominant(dist: Map<StallCode, number>, minSamples: number, threshold: number): { stall: StallCode; confidence: number } | null {
    const total = [...dist.values()].reduce((s, v) => s + v, 0);
    if (total < minSamples) return null;
    let bestStall: StallCode | null = null;
    let bestCount = 0;
    for (const [stall, count] of dist) {
        if (count > bestCount) {
            bestStall = stall;
            bestCount = count;
        }
    }
    if (!bestStall) return null;
    const share = bestCount / total;
    if (share < threshold) return null;
    return { stall: bestStall, confidence: share };
}

export async function classifyStall(input: ClassifyStallInput): Promise<StallSuggestion> {
    const { tenantId, note, vendorId, itemId, excludeEntryId } = input;

    // 1) 備註直接推斷（最可靠）
    const noteInference = inferStallFromNote(note);
    if (noteInference.stall !== 'unknown') {
        return {
            stall: noteInference.stall,
            confidence: noteInference.confidence,
            method: noteInference.isKnownTypo ? 'note-typo-alias' : 'note-alias',
            detail: `備註「${note}」命中${noteInference.isKnownTypo ? '已知錯字變體' : '標準'}別名「${noteInference.matchedAlias}」`,
        };
    }

    // 2) 廠商歷史分布
    if (vendorId) {
        const dist = await historyStallDistribution(tenantId, { vendorId }, excludeEntryId);
        const dominant = pickDominant(dist, VENDOR_MIN_SAMPLES, VENDOR_CONFIDENCE_THRESHOLD);
        if (dominant) {
            return {
                stall: dominant.stall,
                confidence: dominant.confidence,
                method: 'vendor-history',
                detail: `該廠商過去有攤位備註的記錄中，${(dominant.confidence * 100).toFixed(0)}% 屬於${dominant.stall === 'pingtung' ? '屏東' : '潮州'}`,
            };
        }
    }

    // 3) 品項歷史分布（訊號較弱，門檻較嚴）
    if (itemId) {
        const dist = await historyStallDistribution(tenantId, { itemId }, excludeEntryId);
        const dominant = pickDominant(dist, ITEM_MIN_SAMPLES, ITEM_CONFIDENCE_THRESHOLD);
        if (dominant) {
            return {
                stall: dominant.stall,
                confidence: dominant.confidence,
                method: 'item-history',
                detail: `該品項過去有攤位備註的記錄中，${(dominant.confidence * 100).toFixed(0)}% 屬於${dominant.stall === 'pingtung' ? '屏東' : '潮州'}`,
            };
        }
    }

    return {
        stall: 'unknown',
        confidence: 0,
        method: 'insufficient-data',
        detail: '備註無法判斷攤位，且廠商/品項的歷史資料不足或分布不夠集中，不猜測',
    };
}
