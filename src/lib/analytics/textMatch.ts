// 輕量中文 fuzzy 比對工具 — 分類 (#8/#9) 與搜尋 (#1/#3) 共用。
//
// 刻意跟 bot/matcher.ts 的 fuzzyScore 分開實作（沒有互相 import）：
// - T-ML-025 批 1 範圍禁止碰 bot/ 目錄，import 會造成批 1/2 之間不必要的耦合
// - 用途也不同：bot/matcher.ts 是即時解析單筆輸入，這裡是批次分析/分類既有資料，
//   演算法沒有必要跟 bot 綁死在一起，各自獨立比較好維護
// 演算法本身故意保持跟 bot/matcher.ts 神似（字元重疊率 + 短詞懲罰），
// 因為那套邏輯已經在真實資料上驗證過相當堪用，重新發明一套沒必要。

/** 字元重疊率 fuzzy 分數（0~1）。1 = 完全相等，0.85 = 其中一方是另一方子字串 */
export function fuzzyScore(query: string, target: string): number {
    const q = query.trim().toLowerCase();
    const t = target.trim().toLowerCase();
    if (!q || !t) return 0;
    if (t === q) return 1.0;
    if (t.includes(q) || q.includes(t)) return 0.85;

    const qChars = [...new Set(q.split(''))];
    const tChars = new Set(t.split(''));
    const intersection = qChars.filter((c) => tChars.has(c)).length;
    const baseScore = intersection / Math.max(qChars.length, tChars.size);

    // 短詞懲罰：1 字以下容易因單一共同字誤判
    const minLen = Math.min(q.length, t.length);
    return minLen <= 1 ? baseScore * 0.75 : baseScore;
}

export interface FuzzyMatch<T> {
    item: T;
    score: number;
}

/** 對候選清單逐一評分，回傳依分數由高到低排序、且 >= threshold 的候選 */
export function fuzzyRank<T>(
    query: string,
    candidates: T[],
    getText: (item: T) => string,
    threshold = 0
): FuzzyMatch<T>[] {
    const results: FuzzyMatch<T>[] = candidates
        .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
        .filter((r) => r.score >= threshold);
    results.sort((a, b) => b.score - a.score);
    return results;
}
