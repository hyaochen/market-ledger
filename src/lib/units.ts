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
