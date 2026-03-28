// Ollama NLP 解析模組
// 策略：LLM 只負責「文字提取」（品項名、數量、金額），DB 比對由 matcher.ts 負責

import type { ParsedEntry, DbContext } from './types';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL_FAST = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';

// 精簡 prompt：只提取文字資訊，不傳 DB 清單，不要求 ID
function buildSystemPrompt(today: string, locationNames: string[]): string {
    const locHint = locationNames.length > 0
        ? `\n營業額地點（REVENUE）：${locationNames.join('、')}`
        : '';
    return `你是記帳文字解析助理。今天：${today}。

任務：從中文記帳文字提取每筆記錄，輸出 JSON。

★ 最重要規則 ★
1. 數字絕對不做任何計算、換算、四捨五入，直接從原文複製
2. 識別方式：有重量/數量單位（臺斤/台斤/斤/公斤/kg/個/包/條/份/箱/罐/瓶）緊接的數字 → quantity；沒有單位的獨立數字 → price
3. 金額和數量的前後順序不影響判斷，完全依靠「有無單位」決定
4. 【斤兩格式】遇到「X斤Y兩」（如「2斤10兩」「3斤5兩」），unit 填"斤兩"，quantity 填斤的數字（兩的部分系統自動處理）
- 例：「180臺斤1500塊」→ quantity:180, unit:"臺斤", price:1500
- 例：「64.9臺斤 15251」→ quantity:64.9, unit:"臺斤", price:15251
- 例：「五花肉 6000 2斤」→ quantity:2, unit:"斤", price:6000（6000無單位=price，2斤有單位=quantity）
- 例：「五花肉 5000 2.7斤」→ quantity:2.7, unit:"斤", price:5000
- 例：「五花肉 3000 1斤」→ quantity:1, unit:"斤", price:3000
- 例：「兩箱2160」→ quantity:2, unit:"箱", price:2160
- 例：「泉水1000」→ quantity:null, unit:null, price:1000（唯一數字無單位→price）
- 例：「薪資1300」→ EXPENSE, price:1300
- 例：「肝蓮2斤10兩250廠商海豐」→ quantity:2, unit:"斤兩", price:250, vendorName:"海豐"

類型（type）：
- PURCHASE：食材/商品名稱 + 數量/重量 + 金額
- EXPENSE：薪資/清潔費/停車費/油費/洗攤/洗碗精等費用支出（itemName 填支出名稱，可含數量單位）
- REVENUE：攤位/店面的營業額。★ 只有當輸入主體是「地點名/攤位名 + 金額」時才是 REVENUE，「備註」後面出現的地名絕對不觸發 REVENUE${locHint}

REVENUE 時：itemName 填地點名稱（如「潮州」「屏東」），quantity/unit 為 null
EXPENSE 時：itemName 填支出名稱（如「薪資」「清潔費」「洗碗精」「洗攤」），有數量時填 quantity/unit
★ 類型判斷優先順序：若輸入開頭是費用名稱（薪資/清潔費/洗攤/洗碗精/電費/租金/瓦斯等），一定是 EXPENSE，不管備註裡有無地名
廠商：「廠商XXX」「向XXX買」才填 vendorName，vendorName 只填廠商名稱本身，不含「廠商」二字
  - 例：「廠商海豐」→ vendorName:"海豐"（不是"廠商海豐"）
  - 例：「廠商哈哈哈」→ vendorName:"哈哈哈"
備註：「備註XXX」才填，否則 null
日期：有「3/3」「3月3日」「3月4號」才填，否則 ${today}

輸入範例 → 輸出範例：
- 「薪資1300備註阿秀」→ {"type":"EXPENSE","itemName":"薪資","price":1300,"note":"阿秀"}
- 「3月4號清潔費200備註中山」→ {"type":"EXPENSE","date":"YYYY-03-04","itemName":"清潔費","price":200,"note":"中山"}
- 「洗攤250備註潮州」→ {"type":"EXPENSE","itemName":"洗攤","price":250,"note":"潮州"}（開頭是費用→EXPENSE，潮州在備註裡不觸發REVENUE）
- 「洗攤250備註中山」→ {"type":"EXPENSE","itemName":"洗攤","price":250,"note":"中山"}
- 「清潔費110備註中山」→ {"type":"EXPENSE","itemName":"清潔費","price":110,"note":"中山"}
- 「潮州3000」→ {"type":"REVENUE","itemName":"潮州","price":3000}（主體是地點→REVENUE）
- 「屏東攤位5000」→ {"type":"REVENUE","itemName":"屏東攤位","price":5000}
- 「洗碗精12桶560」→ {"type":"EXPENSE","itemName":"洗碗精","quantity":12,"unit":"桶","price":560}
- 「漂白水2桶40」→ {"type":"EXPENSE","itemName":"漂白水","quantity":2,"unit":"桶","price":40}
- 「肝連2.6台斤218廠商海豐」→ {"type":"PURCHASE","itemName":"肝連","quantity":2.6,"unit":"台斤","price":218,"vendorName":"海豐"}
- 「頭皮3個350」→ {"type":"PURCHASE","itemName":"頭皮","quantity":3,"unit":"個","price":350}（食材品項+數量→PURCHASE，不是費用）

輸出（只輸出JSON，不加任何說明文字）：
{"entries":[{"type":"PURCHASE","date":"${today}","itemName":"品項名稱","quantity":2,"unit":"斤","price":6000,"vendorName":"廠商名稱","note":null,"rawInput":"原始文字"}]}`;
}

async function callOllama(systemPrompt: string, userText: string, model: string): Promise<RawExtracted[] | null> {
    console.log(`[Parser] Calling ${model} for: ${userText.slice(0, 60)}`);
    const t0 = Date.now();
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userText },
                ],
                format: 'json',
                stream: false,
                options: { temperature: 0.1, num_predict: 1024 },
            }),
            signal: AbortSignal.timeout(60000),
        });

        console.log(`[Parser] ${model} responded in ${Date.now() - t0}ms, status=${response.status}`);
        if (!response.ok) {
            console.error(`[Parser] HTTP error ${response.status}`);
            return null;
        }
        const data = await response.json() as { message?: { content?: string } };
        const content = data?.message?.content;
        if (!content) {
            console.error('[Parser] Empty content from model');
            return null;
        }

        console.log(`[Parser] Raw response: ${content.slice(0, 400)}`);

        const parsed = JSON.parse(content);
        let arr: unknown[] | null = null;
        if (Array.isArray(parsed)) {
            arr = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
            for (const val of Object.values(parsed)) {
                if (Array.isArray(val)) { arr = val; break; }
            }
        }
        if (!arr) {
            // LLM 有時回傳單一物件而非陣列，嘗試包裝
            if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
                arr = [parsed];
                console.log('[Parser] Wrapped single entry object in array');
            } else {
                console.error('[Parser] No array found. Keys:', Object.keys(parsed).join(', '));
                return null;
            }
        }

        console.log(`[Parser] Extracted ${arr.length} entries`);
        return arr as RawExtracted[];
    } catch (e) {
        console.error(`[Parser] Failed (${model}) after ${Date.now() - t0}ms:`, e);
        return null;
    }
}

// LLM 輸出的原始結構（不含 DB ID）
interface RawExtracted {
    type?: string;
    date?: string;
    itemName?: string | null;
    quantity?: number | null;
    unit?: string | null;
    price?: number;
    vendorName?: string | null;
    note?: string | null;
    rawInput?: string;
}

// 量詞單位（重量/數量）— 不含貨幣詞
const QTY_UNITS = ['臺斤', '台斤', '公斤', '斤', 'kg', 'KG', 'g', 'G', '個', '包', '條', '份', '箱', '罐', '瓶', '桶', '組', '片', '顆', '克', '袋'];
const QTY_UNIT_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${QTY_UNITS.join('|')})`, 'g');
const CHINESE_NUM: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const CN_QTY_UNIT_RE = new RegExp(`([一兩二三四五六七八九十])\\s*(${QTY_UNITS.join('|')})`, 'g');

// 斤兩格式：「2斤10兩」→ quantity=210, unit='jl'（1斤=16兩，16進位）
const JIN_LIANG_RE = /(\d+)斤(\d+)兩/;

/** 若 rawInput 含「X斤Y兩」格式，將 entry 的 quantity/unit 換成 jl 編碼（覆蓋 LLM 結果） */
function fixJinLiangFromRaw(entry: RawExtracted): RawExtracted {
    const raw = normalizeNumbers(entry.rawInput ?? '');
    const m = raw.match(JIN_LIANG_RE);
    if (!m) return entry;
    const jin = parseInt(m[1], 10);
    const liang = parseInt(m[2], 10);
    if (liang > 15) {
        console.log(`[Parser] 斤兩: liang=${liang} > 15，跳過`);
        return entry;
    }
    const encoded = jin * 100 + liang;
    console.log(`[Parser] 斤兩: ${jin}斤${liang}兩 → quantity=${encoded}, unit='jl'`);
    return { ...entry, quantity: encoded, unit: 'jl' };
}

// 單位字串 → 標準 DB 代碼
const UNIT_NORMALIZE: Record<string, string> = {
    '斤': 'catty', '臺斤': 'catty', '台斤': 'catty',
    '公斤': 'kg', 'KG': 'kg', 'kG': 'kg',
    '斤兩': 'jl',  // LLM 可能輸出中文標籤
};

/** 將 LLM 輸出的單位字串正規化為 DB 代碼，並對 catty 小數自動轉 jl */
function normalizeUnit(entry: RawExtracted): RawExtracted {
    if (!entry.unit || entry.unit === 'jl') return entry;

    const normalized = UNIT_NORMALIZE[entry.unit] ?? entry.unit.toLowerCase();

    if (normalized === 'jl' && entry.quantity != null) {
        // LLM 輸出 "斤兩"，但數字可能已是小數格式，嘗試解碼
        const qty = entry.quantity;
        if (qty % 1 !== 0) {
            const decStr = qty.toString().split('.')[1] || '0';
            const liang = parseInt(decStr, 10);
            if (liang <= 15) {
                const encoded = Math.floor(qty) * 100 + liang;
                return { ...entry, unit: 'jl', quantity: encoded };
            }
        }
        return { ...entry, unit: 'jl' };
    }

    if (normalized === 'catty' && entry.quantity != null && entry.quantity % 1 !== 0) {
        // catty 類型有小數 → 嘗試轉 jl
        const decStr = entry.quantity.toString().split('.')[1] || '0';
        const liang = parseInt(decStr, 10);
        if (liang <= 15) {
            const encoded = Math.floor(entry.quantity) * 100 + liang;
            console.log(`[Parser] catty decimal: ${entry.quantity}斤 → ${Math.floor(entry.quantity)}斤${liang}兩 (encoded=${encoded})`);
            return { ...entry, unit: 'jl', quantity: encoded };
        }
    }

    return { ...entry, unit: normalized };
}

// 正規化非標準數字格式（1ˋ500 → 1500, 1,500 → 1500）
function normalizeNumbers(text: string): string {
    return text.replace(/(\d+)[\u02CB,ˋ](\d{3})/g, '$1$2');
}

// 中文數字對照表
const CN_DIGIT: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

// 解析中文數字字串為阿拉伯數字（支援 個位/十位）
function parseCnNumber(s: string): number | null {
    if (s.length === 1) {
        if (s === '十') return 10;
        return CN_DIGIT[s] ?? null;
    }
    // 十X → 10~19
    if (s.startsWith('十')) {
        const rest = s.slice(1);
        if (!rest) return 10;
        if (rest.length === 1) {
            const d = CN_DIGIT[rest];
            return d !== undefined ? 10 + d : null;
        }
    }
    // X十Y → 20~99
    const tenIdx = s.indexOf('十');
    if (tenIdx > 0 && !s.includes('百') && !s.includes('千')) {
        const tens = CN_DIGIT[s.slice(0, tenIdx)];
        const onesPart = s.slice(tenIdx + 1);
        const ones = onesPart ? (CN_DIGIT[onesPart] ?? null) : 0;
        return tens !== undefined && ones !== null ? tens * 10 + ones : null;
    }
    return null;
}

// 將輸入中的中文數量詞轉為阿拉伯數字（「兩斤」→「2斤」、「十二個」→「12個」）
// 只轉換「中文數字+單位」模式，避免誤改品名中的中文字
function convertChineseNumbers(text: string): string {
    const CN_CHARS = '零一二兩三四五六七八九十';
    const UNIT_CHARS = '斤兩公臺台克個包箱條份罐瓶桶組片顆袋只';
    return text.replace(
        new RegExp(`([${CN_CHARS}]+)(?=[${UNIT_CHARS}])`, 'g'),
        (match) => {
            const n = parseCnNumber(match);
            return n !== null ? String(n) : match;
        },
    );
}

// 後處理：用正則從 rawInput 修正 LLM 可能算錯的 quantity/price
// 策略：找出有單位的數字（→ quantity）和無單位的獨立數字（→ price）
function fixNumbersFromRaw(entry: RawExtracted): RawExtracted {
    // jl 已由 fixJinLiangFromRaw 處理完畢，跳過此步驟
    if (entry.unit === 'jl') return entry;

    const raw = normalizeNumbers(entry.rawInput ?? '');

    // 找所有「數字+量詞」組合
    const unitMatches: { qty: number; unit: string; raw: string }[] = [];
    for (const m of raw.matchAll(QTY_UNIT_RE)) {
        unitMatches.push({ qty: parseFloat(m[1]), unit: m[2], raw: m[0] });
    }
    for (const m of raw.matchAll(CN_QTY_UNIT_RE)) {
        const qty = CHINESE_NUM[m[1]];
        if (qty) unitMatches.push({ qty, unit: m[2], raw: m[0] });
    }

    if (unitMatches.length !== 1) {
        // 0 個單位 = 純價格；多個單位 = 不確定，保留 LLM 結果
        if (unitMatches.length === 0 && entry.price == null) {
            // 唯一數字當 price
            const nums = [...normalizeNumbers(raw).matchAll(/(\d+(?:\.\d+)?)/g)];
            if (nums.length === 1) return { ...entry, quantity: null, unit: null, price: parseFloat(nums[0][1]) };
        }
        return entry;
    }

    const { qty, unit, raw: unitStr } = unitMatches[0];

    // 把「數字+單位」部分從 raw 移除，剩餘文字中找獨立數字
    const remaining = raw.replace(unitStr, '');
    const priceNums = [...remaining.matchAll(/(\d+(?:\.\d+)?)/g)]
        .map(m => parseFloat(m[1]))
        .filter(n => n > 0 && n !== qty);

    if (priceNums.length === 1) {
        const price = priceNums[0];
        if (entry.quantity !== qty || entry.price !== price) {
            console.log(`[Parser] fixNumbers: "${raw.trim()}" qty ${entry.quantity}→${qty} ${unit}, price ${entry.price}→${price}`);
        }
        return { ...entry, quantity: qty, unit, price };
    }

    return entry;
}

/** EXPENSE 無單位但有 quantity 沒有 price → LLM 把金額放到 quantity 欄位，修正回 price */
function fixExpenseAmountField(entry: RawExtracted): RawExtracted {
    if (entry.type !== 'EXPENSE') return entry;
    if (entry.unit != null) return entry;                          // 有單位，quantity 是合法數量
    if (entry.quantity == null) return entry;                      // 沒有 quantity 不需修正
    if (entry.price != null && entry.price > 0) return entry;     // 已有正確金額
    console.log(`[Parser] EXPENSE amount fix: quantity=${entry.quantity} → price`);
    return { ...entry, price: entry.quantity, quantity: null };
}

/**
 * REVENUE 誤判修正：LLM 看到備註裡的地名就誤判成 REVENUE
 * 規則：若 rawInput 含「備註」，且「備註」前的文字不像是純地點+金額，改回 EXPENSE
 * 例：「洗攤250備註潮州」LLM 誤判 REVENUE → 強制改 EXPENSE
 */
function fixRevenueFromNote(entry: RawExtracted): RawExtracted {
    if (entry.type !== 'REVENUE') return entry;
    const raw = entry.rawInput ?? '';
    // 若有「備註」，且「備註」前面不是「地點名+金額」的純形式，則強制改 EXPENSE
    const noteIdx = raw.indexOf('備註');
    if (noteIdx > 0) {
        const beforeNote = raw.slice(0, noteIdx).trim();
        // 若備註前的文字包含非數字漢字（即費用名稱），就是 EXPENSE 而非 REVENUE
        const hasExpenseName = /[\u4e00-\u9fff]/.test(beforeNote.replace(/\d+/g, '').replace(/[.斤兩台臺公斤kg個包]/g, '').trim());
        if (hasExpenseName) {
            console.log(`[Parser] REVENUE→EXPENSE fix: rawInput="${raw}" (備註前有費用名稱)`);
            return { ...entry, type: 'EXPENSE' };
        }
    }
    return entry;
}

// 主要解析函式：只用快速模型，不再 fallback 到 32b
export async function parseEntries(userText: string, ctx: DbContext): Promise<ParsedEntry[]> {
    const today = new Date().toLocaleDateString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).replace(/\//g, '-');

    const locationNames = ctx.locations.map(l => l.name);
    const systemPrompt = buildSystemPrompt(today, locationNames);

    // 中文數字前處理：「兩斤」→「2斤」，再交給 LLM（rawInput 保留原始值）
    const normalizedText = convertChineseNumbers(normalizeNumbers(userText));

    // 防呆：純日期輸入（如「3月20號」「3/20」）直接忽略，避免誤記
    const stripped = normalizedText.replace(/\s+/g, '');
    if (/^(\d{1,2})[月\/](\d{1,2})[日號]?$|^\d{1,2}[日號]$/.test(stripped)) {
        console.log('[Parser] Date-only input ignored:', userText.trim());
        return [];
    }

    // 判斷是否多行輸入（按換行分隔的獨立記錄行）
    const inputLines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
    const isMultiLine = inputLines.length > 1;

    let result = await callOllama(systemPrompt, normalizedText, OLLAMA_MODEL_FAST);

    if (!result || result.length === 0) {
        console.log('[Parser] Fast model failed or empty, no result');
        return [];
    }

    // 多行輸入但 LLM 只回傳 1 筆 → 逐行重新解析補漏
    if (isMultiLine && result.length < inputLines.length) {
        console.log(`[Parser] Multi-line input (${inputLines.length} lines) but only got ${result.length} entry, retrying per-line`);
        const perLineResults: RawExtracted[] = [];
        for (const line of inputLines) {
            const lineResult = await callOllama(systemPrompt, line, OLLAMA_MODEL_FAST);
            if (lineResult && lineResult.length > 0) {
                // 確保 rawInput 指向這行
                perLineResults.push(...lineResult.map(e => ({ ...e, rawInput: e.rawInput ?? line })));
            }
        }
        if (perLineResults.length > result.length) {
            console.log(`[Parser] Per-line retry got ${perLineResults.length} entries`);
            result = perLineResults;
        }
    }

    // 後處理：斤兩格式 → 一般數字修正 → 單位正規化 → EXPENSE 金額欄位修正 → REVENUE 誤判修正
    result = result.map(fixJinLiangFromRaw).map(fixNumbersFromRaw).map(normalizeUnit).map(fixExpenseAmountField).map(fixRevenueFromNote);

    // 轉換為 ParsedEntry（itemId/vendorId/expenseType/locationId 留給 matcher.ts 填入）
    return result.map(entry => {
        const type = entry.type === 'EXPENSE' ? 'EXPENSE'
            : entry.type === 'REVENUE' ? 'REVENUE'
            : 'PURCHASE';
        return {
            type: type as 'PURCHASE' | 'EXPENSE' | 'REVENUE',
            date: entry.date ?? today,
            itemId: null,
            itemName: entry.itemName ?? null,
            expenseType: null,
            locationId: null,
            locationName: entry.itemName ?? null, // REVENUE 時 itemName 是地點名
            quantity: typeof entry.quantity === 'number' ? entry.quantity : null,
            unit: entry.unit ?? null,
            price: typeof entry.price === 'number' ? entry.price : 0,
            vendorId: null,
            vendorName: entry.vendorName ?? null,
            note: entry.note ?? null,
            confident: true,
            uncertainReason: null,
            rawInput: entry.rawInput ?? userText,
        };
    });
}
