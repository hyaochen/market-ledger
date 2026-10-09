// T-ML-018：Telegram bot 品項關鍵字 ↔ 標準品項名稱對照
// owner 2026-06-17 需求：使用者打「5 包味精」「進 3 包 1600」要能對應到指定 SKU
//
// 設計取捨：
//  - DB Item.name 唯一鍵是 (name, categoryId, tenantId)。owner 兩個 SKU
//    16-1600G / 16-1601G 顯示名都叫「大骨高湯」，DB 端必須拆名為
//    「大骨高湯1600」/「大骨高湯1601」才能並存。
//  - 品項代號（如 16-1203G）是 owner 內部 SKU 編號，DB 不存（不加 column）。
//  - 數字 keyword（1600/1601）會跟既有 parser「無單位 → 視為 price」邏輯衝突
//    → 用 pre-LLM mask 把數字 keyword 置換成標準品項名，讓 LLM 認得是品名而非價格
//    → 同時保留 keyword → itemName 反向對照，matcher 兜底命中

export interface ItemKeyword {
    keyword: string;
    itemName: string;
    code: string;
    isNumeric: boolean;
}

export const ITEM_KEYWORDS: ItemKeyword[] = [
    { keyword: '味精', itemName: '味鮮A', code: '16-1203G', isNumeric: false },
    { keyword: '1600', itemName: '大骨高湯1600', code: '16-1600G', isNumeric: true },
    { keyword: '1601', itemName: '大骨高湯1601', code: '16-1601G', isNumeric: true },
    { keyword: '滷包', itemName: '滷包香料', code: '18-1101G', isNumeric: false },
    { keyword: '滷汁粉', itemName: '滷汁粉', code: '20-0023G', isNumeric: false },
];

/**
 * 口語前綴：使用者常在數字 keyword 前加口語描述（「大骨粉，1600 40公斤」）。
 * mask 時要把這段一起吸收，否則「大骨粉，大骨高湯1600」會被 LLM 拆成兩個品項
 * （2026-10-09 BotMessageLog id=144 事故）。長的放前面，regex alternation 才會先吃長的。
 */
export const NUMERIC_COLLOQUIAL_PREFIXES = ['大骨高湯', '大骨粉', '大骨湯', '大骨', '高湯'];

/**
 * 口語名稱單獨出現（沒寫 1600/1601）時對不到單一 SKU：列出候選讓使用者選，不自動存。
 */
export const AMBIGUOUS_COLLOQUIAL: { terms: string[]; candidates: string[] }[] = [
    { terms: ['大骨粉', '大骨高湯', '大骨湯'], candidates: ['大骨高湯1600', '大骨高湯1601'] },
];

/** itemName 是否為口語模糊名（回傳其候選標準品名；否則 null） */
export function getAmbiguousCandidates(name: string | null | undefined): string[] | null {
    if (!name) return null;
    const n = name.trim();
    for (const g of AMBIGUOUS_COLLOQUIAL) {
        if (g.terms.includes(n)) return g.candidates;
    }
    return null;
}

const CANONICAL_NAME_SET = new Set(ITEM_KEYWORDS.map(k => k.itemName));

/** 偵測 input 中第一個出現的關鍵字（中文 substring；數字 word-boundary） */
export function detectItemKeyword(input: string | null | undefined): ItemKeyword | null {
    if (!input) return null;
    for (const k of ITEM_KEYWORDS) {
        if (k.isNumeric) {
            const re = new RegExp(`(?<!\\d)${k.keyword}(?!\\d)`);
            if (re.test(input)) return k;
        } else {
            if (input.includes(k.keyword)) return k;
        }
    }
    return null;
}

/** itemName 是否為本表內已知標準名稱（matcher 用來判斷是否走 fuzzy） */
export function isCanonicalItemKeywordName(name: string | null | undefined): boolean {
    return !!name && CANONICAL_NAME_SET.has(name);
}

/**
 * 給 LLM 看的 input 預處理：把關鍵字置換成標準品項名稱。
 * - 數字 keyword 特別重要：不置換 LLM 會把 1600 當成 price
 * - 中文 keyword 置換則保證 LLM 直接輸出標準名稱，省去 fuzzy
 */
export function maskKeywordsForLlm(input: string): string {
    let out = input;
    for (const k of ITEM_KEYWORDS) {
        if (k.isNumeric) {
            // 吸收緊鄰的口語前綴（含中間逗號/空白），整段只剩一個標準品名
            const prefix = NUMERIC_COLLOQUIAL_PREFIXES.join('|');
            out = out.replace(
                new RegExp(`(?:(?:${prefix})[\\s,，、:：]*)?(?<!\\d)${k.keyword}(?!\\d)`, 'g'),
                k.itemName,
            );
        } else {
            // 中文無詞邊界，全部置換
            out = out.split(k.keyword).join(k.itemName);
        }
    }
    return out;
}

/**
 * 把已置換的「標準品項名稱（含數字尾）」整段從文字中移除。
 * 用途：parser fixNumbersFromRaw 在 rawInput 內找價格時，要先把
 * 已 mask 的「大骨高湯1600」整段拿掉，1600 才不會被誤抓為 price。
 */
export function stripCanonicalNumericNames(text: string): string {
    let out = text;
    for (const k of ITEM_KEYWORDS) {
        if (!k.isNumeric) continue;
        out = out.split(k.itemName).join('');
    }
    return out;
}

const AMBIGUOUS_FAMILY_NAMES = new Set(AMBIGUOUS_COLLOQUIAL.flatMap(g => [...g.terms, ...g.candidates]));

/**
 * 兩個品項名是否互為包含/同義（用於同一則訊息解析成多筆時的防重複合併）。
 * 規則：其中一個包含另一個（至少 2 字），或兩者都屬於同一組口語/標準名（大骨粉 / 大骨高湯 / 大骨高湯1600）。
 */
export function areSameItemFamily(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = (a ?? '').trim();
    const y = (b ?? '').trim();
    if (x.length < 2 || y.length < 2) return false;
    if (x === y) return true;
    if (x.includes(y) || y.includes(x)) return true;
    return AMBIGUOUS_FAMILY_NAMES.has(x) && AMBIGUOUS_FAMILY_NAMES.has(y);
}

/** 合併時留哪個名稱：標準品名優先，其次較長者 */
export function pickPreferredItemName(a: string, b: string): string {
    const ca = isCanonicalItemKeywordName(a);
    const cb = isCanonicalItemKeywordName(b);
    if (ca !== cb) return ca ? a : b;
    return b.length > a.length ? b : a;
}
