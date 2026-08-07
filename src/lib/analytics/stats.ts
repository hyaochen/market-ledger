// 穩健統計工具 — 異常偵測用。
// 用中位數 / MAD（Median Absolute Deviation）而非平均值/標準差，
// 因為攤商資料筆數少（單一品項一個月常常只有 3-6 筆），少數幾筆離群值
// 用平均值/標準差算會被離群值自己拉走（掩蓋掉自己），MAD 對此穩健得多。

export function median(values: number[]): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median Absolute Deviation，未乘上一致性常數（呼叫端依需求自己乘 1.4826 轉成類 std） */
export function mad(values: number[], med?: number): number {
    if (values.length === 0) return NaN;
    const m = med ?? median(values);
    const deviations = values.map((v) => Math.abs(v - m));
    return median(deviations);
}

/**
 * 穩健 z-score（modified z-score，Iglewicz & Hoaglin 1993 的 0.6745 常數）。
 * |score| >= threshold（常用 3.5）視為離群值。
 * MAD=0（資料太集中/筆數太少）時退化用「跟中位數的比值」判斷，避免除以零。
 */
export function robustZScore(value: number, values: number[]): number {
    const med = median(values);
    const m = mad(values, med);
    if (m > 0) {
        return (0.6745 * (value - med)) / m;
    }
    // MAD=0：所有值幾乎相同，改用相對比例，med=0 時直接視為無法判斷（回 0）
    if (med === 0) return 0;
    return ((value - med) / med) * 10; // 放大係數讓「明顯偏離」在退化情況下也能超過閾值
}
