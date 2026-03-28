export type UnitType = string;

export interface UnitDef {
    code: UnitType;
    name: string;
    toKg?: number; // 如果是標準轉換
    isWeight: boolean;
}

export type UnitMeta = {
    toKg?: number;
    isWeight?: boolean;
};

export const UNITS: UnitDef[] = [
    { code: 'kg', name: '公斤', toKg: 1, isWeight: true },
    { code: 'catty', name: '臺斤', toKg: 0.6, isWeight: true },
    { code: 'jl', name: '斤兩', isWeight: true },  // 編碼：inputQuantity = 斤×100+兩（如 2斤10兩→210）
    { code: 'bundle', name: '捆', isWeight: false },
    { code: 'bag', name: '袋', isWeight: false },
    { code: 'basket', name: '籃', isWeight: false },
    { code: 'pack', name: '包', isWeight: false },
    { code: 'strip', name: '條', isWeight: false },
    { code: 'box', name: '箱', isWeight: false },
    { code: 'bucket', name: '桶', isWeight: false },
];

export function parseUnitMeta(meta?: string | null): UnitMeta {
    if (!meta) return {};
    try {
        const parsed = JSON.parse(meta);
        return {
            toKg: typeof parsed.toKg === 'number' ? parsed.toKg : undefined,
            isWeight: typeof parsed.isWeight === 'boolean' ? parsed.isWeight : undefined,
        };
    } catch {
        return {};
    }
}

export function getUnitLabel(unit: string, units: UnitDef[] = UNITS): string {
    const unitDef = units.find(u => u.code === unit);
    return unitDef?.name || unit;
}

export function convertToKg(weight: number, unit: UnitType, units: UnitDef[] = UNITS): number | null {
    const unitDef = units.find(u => u.code === unit);
    if (!unitDef || !unitDef.isWeight || !unitDef.toKg) return null;
    return weight * unitDef.toKg;
}

export function formatPrice(price: number): string {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0 }).format(price);
}

export function formatWeight(weight: number, toUnit: 'kg' | 'catty' = 'catty'): string {
    if (toUnit === 'kg') return `${weight.toFixed(2)} 公斤`;
    // kg to catty: weight / 0.6
    return `${(weight / 0.6).toFixed(2)} 臺斤`;
}

// ── 斤兩（jl）編碼工具 ────────────────────────────────────────────
// 編碼：2斤10兩 → 210（jin×100 + liang，liang 範圍 0-15）
// 解碼：210 → { jin: 2, liang: 10 }

export function encodeJinLiang(jin: number, liang: number): number {
    return Math.floor(jin) * 100 + Math.max(0, Math.min(15, Math.floor(liang)));
}

export function decodeJinLiang(encoded: number): { jin: number; liang: number } {
    const jin = Math.floor(encoded / 100);
    const liang = Math.round(encoded % 100);
    return { jin, liang };
}

/** 將 jl 編碼值轉換為公斤 */
export function jinLiangToKg(encoded: number): number {
    const { jin, liang } = decodeJinLiang(encoded);
    return (jin + liang / 16) * 0.6;
}

/** 將 jl 編碼值轉為顯示字串，例如 210 → "2斤10兩" */
export function formatJinLiang(encoded: number): string {
    const { jin, liang } = decodeJinLiang(encoded);
    return liang > 0 ? `${jin}斤${liang}兩` : `${jin}斤`;
}

/** 顯示數量 + 單位（自動處理 jl 特殊格式） */
export function formatQuantityDisplay(qty: number | null | undefined, unit: string | null | undefined): string {
    if (qty == null || unit == null) return '';
    if (unit === 'jl') return formatJinLiang(qty);
    return `${qty} ${getUnitLabel(unit)}`;
}
