// 攤位（屏東 / 潮州）備註字串推斷
//
// 背景：Entry（進貨/支出）表沒有 locationId 欄位，攤位只能靠 note 字串判斷。
// Revenue 表有正式的 locationId，不需要走這套推斷。
//
// 別名清單來源：主控 2026-08-04 / 2026-08-07 稽核（vault/projects/market-ledger/
// reports/2026-07_expense-audit.md）逐日核對真實資料整理出的已知寫法，包含員工
// 手誤的錯字（例如「終身」應為「中山」）。錯字類別故意跟「乾淨」的正式寫法分開
// 存放（見 CANONICAL vs TYPO 陣列），異常偵測（anomalies.ts 案例 5）需要知道
// 「這筆雖然能對應到屏東，但備註本身寫法不乾淨，該提醒 owner 去修」。

export type StallCode = 'pingtung' | 'chaozhou';

export interface StallDef {
    code: StallCode;
    /** 中文短稱，同時也是「乾淨」canonical 備註寫法 */
    label: string;
    /** Location.name（正式資料表用） */
    locationName: string;
}

export const STALLS: StallDef[] = [
    { code: 'pingtung', label: '中山', locationName: '屏東攤位' },
    { code: 'chaozhou', label: '潮州', locationName: '潮州攤位' },
];

// 乾淨寫法：員工應該打這些字，不算異常
const CANONICAL_ALIASES: Record<StallCode, string[]> = {
    pingtung: ['中山', '屏東攤位'],
    chaozhou: ['潮州', '潮州攤位'],
};

// 已知但「不乾淨」的變體 / 錯字（來自 8/4、8/7 稽核逐筆核對真實資料）。
// 能正確對應到攤位，但應該被異常偵測攔下來提醒去修正備註。
const TYPO_ALIASES: Record<StallCode, string[]> = {
    pingtung: ['中三', '中心', '中餐', '屏東', '屏東攤', '終身'],
    chaozhou: ['潮洲', '朝洲', '潮州攤'],
};

export interface LocationInference {
    stall: StallCode | 'unknown';
    /** 0~1，1 = 完全匹配乾淨寫法 */
    confidence: number;
    /** 命中的別名字串（不含備註其餘文字），找不到則 null */
    matchedAlias: string | null;
    /** true = 命中的是已知錯字/不乾淨變體，需要人工修正備註 */
    isKnownTypo: boolean;
}

const UNKNOWN: LocationInference = { stall: 'unknown', confidence: 0, matchedAlias: null, isKnownTypo: false };

/**
 * 從備註字串推斷攤位。策略：
 * 1. 先比對「乾淨」canonical 清單（confidence=1.0）
 * 2. 再比對已知錯字/變體清單（confidence=0.75，isKnownTypo=true）
 * 3. 都比對多個候選別名時取「最長」的（避免「潮州攤」被短別名「潮州」先搶走沒差，
 *    但反過來若清單有互相包含的別名要長的優先，減少誤判空間）
 * 4. 全都沒中 → unknown, confidence 0
 */
export function inferStallFromNote(note: string | null | undefined): LocationInference {
    const text = (note ?? '').trim();
    if (!text) return UNKNOWN;

    // 先掃「乾淨」清單，取命中的最長別名（避免短別名搶先，雖然目前清單無互相包含情形，
    // 但保留這個規則讓未來加別名時行為仍可預期）
    let bestCanonical: { stall: StallCode; alias: string } | null = null;
    for (const stall of STALLS) {
        for (const alias of CANONICAL_ALIASES[stall.code]) {
            if (text.includes(alias) && (!bestCanonical || alias.length > bestCanonical.alias.length)) {
                bestCanonical = { stall: stall.code, alias };
            }
        }
    }
    if (bestCanonical) {
        return { stall: bestCanonical.stall, confidence: 1.0, matchedAlias: bestCanonical.alias, isKnownTypo: false };
    }

    // 沒有乾淨寫法命中，退而求其次比對已知錯字/變體清單
    let bestTypo: { stall: StallCode; alias: string } | null = null;
    for (const stall of STALLS) {
        for (const alias of TYPO_ALIASES[stall.code]) {
            if (text.includes(alias) && (!bestTypo || alias.length > bestTypo.alias.length)) {
                bestTypo = { stall: stall.code, alias };
            }
        }
    }
    if (bestTypo) {
        return { stall: bestTypo.stall, confidence: 0.75, matchedAlias: bestTypo.alias, isKnownTypo: true };
    }

    return UNKNOWN;
}

export function stallLabel(stall: StallCode | 'unknown'): string {
    if (stall === 'unknown') return '無法判斷';
    return STALLS.find((s) => s.code === stall)?.label ?? stall;
}

export function stallLocationName(stall: StallCode): string {
    return STALLS.find((s) => s.code === stall)!.locationName;
}

/** 取得所有「乾淨」寫法，供異常偵測判斷「是否為 canonical」使用 */
export function allCanonicalAliases(): string[] {
    return Object.values(CANONICAL_ALIASES).flat();
}

export function allKnownAliases(): string[] {
    return [...Object.values(CANONICAL_ALIASES).flat(), ...Object.values(TYPO_ALIASES).flat()];
}
