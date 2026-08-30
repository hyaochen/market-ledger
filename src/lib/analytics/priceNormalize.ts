// 單價正規化 — 把不同單位（台斤 catty / 公斤 kg / 斤兩 jl / 個數單位）換算到
// 同一基準（公斤），才能做跨廠商比價、單價離群偵測。
//
// 資料背景（已用 read-only 查詢驗證，非猜測）：
// - Entry.standardWeight 是寫入時就換算好的公斤數。web 表單（src/app/actions/entry.ts）
//   用 convertToKg() 算；bot（bot/handlers/entry.ts:139-140）對 jl 單位特別呼叫
//   jinLiangToKg() 算，兩條路徑目前都會把 standardWeight 填成正確公斤數。
// - 因此本模組優先信任 standardWeight，只有它缺值時才自己用 inputQuantity+inputUnit
//   兜底重算（防禦性，涵蓋任何未來新增、standardWeight 沒填好的路徑）。
// - 個數單位（顆/包/箱/隻…）無法換算重量，回傳 basis:null，呼叫端必須跳過而不是
//   硬湊一個假單價。

import { convertToKg, jinLiangToKg, UNITS, type UnitDef } from '@/lib/units';

export interface WeightBasisPrice {
    /** 換算到公斤基準的單價（元/kg），無法換算則 null */
    pricePerKg: number | null;
    /** 換算用的公斤重量，無法換算則 null */
    kgWeight: number | null;
    basis: 'standardWeight' | 'recomputed' | null;
}

export interface PriceableEntry {
    totalPrice: number;
    standardWeight?: number | null;
    inputQuantity?: number | null;
    inputUnit?: string | null;
}

/**
 * 額外可傳入該租戶自訂單位字典（Dictionary category='unit'），
 * 找不到時退回 src/lib/units.ts 的內建 UNITS。
 */
export function normalizeToKgPrice(entry: PriceableEntry, unitDefs: UnitDef[] = UNITS): WeightBasisPrice {
    if (entry.standardWeight != null && entry.standardWeight > 0) {
        return {
            pricePerKg: entry.totalPrice / entry.standardWeight,
            kgWeight: entry.standardWeight,
            basis: 'standardWeight',
        };
    }

    if (entry.inputQuantity != null && entry.inputUnit) {
        if (entry.inputUnit === 'jl') {
            const kg = jinLiangToKg(entry.inputQuantity);
            if (kg > 0) {
                return { pricePerKg: entry.totalPrice / kg, kgWeight: kg, basis: 'recomputed' };
            }
        } else {
            const kg = convertToKg(entry.inputQuantity, entry.inputUnit, unitDefs);
            if (kg != null && kg > 0) {
                return { pricePerKg: entry.totalPrice / kg, kgWeight: kg, basis: 'recomputed' };
            }
        }
    }

    return { pricePerKg: null, kgWeight: null, basis: null };
}
