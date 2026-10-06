/**
 * 分析頁（/cash/stats）用的純函式（T-ML-034）。
 *
 * 為什麼抽成純函式：
 * - 兩個攤位同一天各有一筆清點，原本的趨勢圖把每筆清點當一個點，日期會重複出現、
 *   折線在兩個攤位的金額之間來回鋸齒。改成「每個攤位一條線」要先把資料依日期轉成樞紐形狀，
 *   這段邏輯要能單元測試。
 * - 本檔不 import React / Recharts / Prisma，server 與 client 都能用。
 *
 * KPI 的計算（總營業額、日均、筆數、最高單日）完全沒有改，仍在 page.tsx。
 */

/**
 * 攤位分類色：依序取自 dataviz 預設色盤前幾個 slot（藍、橘、水藍、黃），
 * 已用 validate_palette 驗證前兩色：CVD ΔE 24.7、normal ΔE 33.6、對比 >= 3:1。
 * 顏色跟著「攤位」走（依該租戶全部攤位的固定順序），篩選只剩一個攤位時它也保持原色。
 * 超過 4 個攤位不再產生新色相，其餘一律用中性灰（documented 規則：不循環、不生新色）。
 */
export const STALL_SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
export const NEUTRAL_SERIES_COLOR = "#78716c";
/** 單一系列、沒有特定攤位可以代表時（全部攤位的支出分類）用的中性色 */
export const NEUTRAL_BAR_COLOR = "#57534e";

export function seriesColorForIndex(index: number): string {
    return index >= 0 && index < STALL_SERIES_COLORS.length ? STALL_SERIES_COLORS[index] : NEUTRAL_SERIES_COLOR;
}

export type TrendSeries = { id: string; name: string; color: string };

export type TrendValue = { total: number; sales: number; expenses: number };

export type TrendPoint = {
    /** YYYY-MM-DD（與歷史頁相同，用 toISOString 的日期部分） */
    date: string;
    values: Record<string, TrendValue>;
};

export type TrendRow = {
    date: Date;
    locationId: string;
    totalSales: number;
    salesTotal: number;
    expensesTotal: number;
};

/**
 * 把每筆清點轉成「依日期、每個攤位一欄」的樞紐資料。
 * - locations 是該租戶全部攤位（含已停用），順序固定，決定顏色；只有真的有資料的攤位才會成為系列
 * - 同一天同一攤位只會有一筆（資料庫唯一鍵），不需要合併
 * - 日期由舊到新排序
 */
export function buildTrend(
    rows: readonly TrendRow[],
    locations: readonly { id: string; name: string }[],
): { series: TrendSeries[]; trend: TrendPoint[] } {
    const withData = new Set(rows.map((r) => r.locationId));
    const series: TrendSeries[] = locations
        .map((l, index) => ({ id: l.id, name: l.name, color: seriesColorForIndex(index) }))
        .filter((s) => withData.has(s.id));

    const byDate = new Map<string, Record<string, TrendValue>>();
    for (const r of rows) {
        const date = r.date.toISOString().slice(0, 10);
        const bucket = byDate.get(date) ?? {};
        bucket[r.locationId] = { total: r.totalSales, sales: r.salesTotal, expenses: r.expensesTotal };
        byDate.set(date, bucket);
    }

    const trend = [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, values]) => ({ date, values }));

    return { series, trend };
}

/**
 * 「日均」這個 KPI 的算法一直是 總營業額 / 清點筆數（每個攤位每天一筆）。
 * 看單一攤位時它就是日均；兩個以上攤位混在一起時其實是「每攤每天平均」，
 * 標成「日均」會讓人以為是兩攤合計的日均，所以只改標籤、不改算法。
 */
export function averageLabel(filteredToOneLocation: boolean, totalLocationCount: number): string {
    return filteredToOneLocation || totalLocationCount <= 1 ? "日均" : "每攤每天平均";
}

/** 圖表 Y 軸刻度：萬為單位（1 萬 = 10,000），小於 1 萬直接用數字。 */
export function formatAxisMoney(v: number): string {
    if (!Number.isFinite(v)) return "";
    if (Math.abs(v) >= 10000) {
        const wan = v / 10000;
        return `${Number.isInteger(wan) ? wan : wan.toFixed(1)}萬`;
    }
    return String(Math.round(v));
}

/** X 軸日期刻度：2026-10-05 -> 10/05 */
export function formatAxisDate(iso: string): string {
    return iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : iso;
}

/** 長名稱截斷（圖表左側的分類名稱）；完整名稱放在 <title> 與表格。 */
export function truncateLabel(text: string, max: number): string {
    const chars = Array.from(text);
    return chars.length <= max ? text : chars.slice(0, max).join("") + "…";
}

/**
 * 最後一個點的直接標籤要不要畫：兩條線的終點太靠近時標籤會疊在一起，
 * 這時不硬把標籤推開（會跟線分離），改成只靠圖例與 tooltip。
 * lastValues 是各系列最後一個點的數值，domainMax 是 Y 軸最大值。
 */
export function endLabelsFit(lastValues: readonly number[], domainMax: number, minGapRatio = 0.12): boolean {
    if (lastValues.length <= 1) return true;
    if (!(domainMax > 0)) return false;
    const sorted = [...lastValues].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
        if ((sorted[i] - sorted[i - 1]) / domainMax < minGapRatio) return false;
    }
    return true;
}
