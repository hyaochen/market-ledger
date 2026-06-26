/**
 * 現金清點面額常數（cashBox / reserve / sales）
 *
 * 為什麼把這些抽出來：
 * - 同一份目標值散落在 CashCountForm.tsx / cash actions / export route / history pages，
 *   每次調整面額就有 5+ 個檔要同步改（T-ML-015 ~ T-ML-019 教訓），高機率遺漏。
 * - TARGET_TOTAL 改用 reduce 動態計算 → 未來只需要動 TARGET_QTY 一行，
 *   合計自動同步，不再需要記得「同時改 7400」這種隱性關聯。
 *
 * 注意：
 * - 本檔同時被 client 元件（CashCountForm）+ server action / route 引用，
 *   絕不 import React-only / DOM-only / Node-only 的 module。
 * - hydration 安全：client + server 跑同樣的 reduce，結果一致，不會引發 mismatch。
 */

// ── 錢盒（CashBox）— 面額張數固定 ──────────────────────────────
export const CASH_BOX_DENOMS = [500, 100, 50, 10, 5] as const;
export const CASH_BOX_TARGET_QTY: Record<number, number> = {
    500: 5,
    100: 28,
    50: 19,
    10: 43,
    5: 21,
};

// ── 備用金（Reserve）— 總額固定 ────────────────────────────────
// T-ML-019：1000 元不設參考張數（DenomTable 拿 undefined 顯示「—」），
// 因為 1000 是換錢用：放 1 張 1000 ↔ 2 張 500，總額仍等於 RESERVE_TARGET_TOTAL，
// 沒有固定張數可參考。
//
// T-ML-020（2026-06-26）：10 元從 100 → 50 個（owner 實務發現囤太多），
// 連帶 RESERVE_TARGET_TOTAL 7,400 → 6,900（由 reduce 自動算出）。
export const RESERVE_DENOMS = [1000, 500, 100, 50, 10, 5] as const;
export const RESERVE_TARGET_QTY: Record<number, number> = {
    500: 5,
    100: 28,
    50: 20,
    10: 50,
    5: 20,
};

// ── 當日營業現金（Sales）— 不設目標 ────────────────────────────
export const SALES_DENOMS = [1000, 500, 100, 50, 10, 5] as const;

// ── Computed totals（單一資料來源，改面額自動同步）───────────────
export const CASH_BOX_TARGET_TOTAL: number = Object.entries(CASH_BOX_TARGET_QTY)
    .reduce((sum, [denom, qty]) => sum + Number(denom) * qty, 0);

export const RESERVE_TARGET_TOTAL: number = Object.entries(RESERVE_TARGET_QTY)
    .reduce((sum, [denom, qty]) => sum + Number(denom) * qty, 0);
