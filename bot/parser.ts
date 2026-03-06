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
- 例：「180臺斤1500塊」→ quantity:180, unit:"臺斤", price:1500
- 例：「64.9臺斤 15251」→ quantity:64.9, unit:"臺斤", price:15251
- 例：「五花肉 6000 2斤」→ quantity:2, unit:"斤", price:6000（6000無單位=price，2斤有單位=quantity）
- 例：「五花肉 5000 2.7斤」→ quantity:2.7, unit:"斤", price:5000
- 例：「五花肉 3000 1斤」→ quantity:1, unit:"斤", price:3000
- 例：「兩箱2160」→ quantity:2, unit:"箱", price:2160
- 例：「泉水1000」→ quantity:null, unit:null, price:1000（唯一數字無單位→price）
- 例：「薪資1300」→ EXPENSE, price:1300

類型（type）：
- PURCHASE：食材/商品名稱 + 數量/重量 + 金額
- EXPENSE：薪資/清潔費/停車費/油費/洗攤費/洗碗精等費用支出（itemName 填支出名稱，可含數量單位）
- REVENUE：攤位/店面的營業額（含「攤位」「地點名」+金額）${locHint}

REVENUE 時：itemName 填地點名稱（如「潮州」「屏東」），quantity/unit 為 null
EXPENSE 時：itemName 填支出名稱（如「薪資」「清潔費」「洗碗精」），有數量時填 quantity/unit
廠商：「廠商XXX」「向XXX買」才填 vendorName，vendorName 只填廠商名稱本身，不含「廠商」二字
  - 例：「廠商海豐」→ vendorName:"海豐"（不是"廠商海豐"）
  - 例：「廠商哈哈哈」→ vendorName:"哈哈哈"
備註：「備註XXX」才填，否則 null
日期：有「3/3」「3月3日」「3月4號」才填，否則 ${today}

輸入範例 → 輸出範例：
- 「薪資1300備註阿秀」→ {"type":"EXPENSE","itemName":"薪資","price":1300,"note":"阿秀"}
- 「3月4號清潔費200備註中山」→ {"type":"EXPENSE","date":"YYYY-03-04","itemName":"清潔費","price":200,"note":"中山"}
- 「洗碗精12桶560」→ {"type":"EXPENSE","itemName":"洗碗精","quantity":12,"unit":"桶","price":560}
- 「漂白水2桶40」→ {"type":"EXPENSE","itemName":"漂白水","quantity":2,"unit":"桶","price":40}
- 「肝連2.6台斤218廠商海豐」→ {"type":"PURCHASE","itemName":"肝連","quantity":2.6,"unit":"台斤","price":218,"vendorName":"海豐"}

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

// 正規化非標準數字格式（1ˋ500 → 1500, 1,500 → 1500）
function normalizeNumbers(text: string): string {
    return text.replace(/(\d+)[\u02CB,ˋ](\d{3})/g, '$1$2');
}

// 後處理：用正則從 rawInput 修正 LLM 可能算錯的 quantity/price
// 策略：找出有單位的數字（→ quantity）和無單位的獨立數字（→ price）
function fixNumbersFromRaw(entry: RawExtracted): RawExtracted {
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

    let result = await callOllama(systemPrompt, userText, OLLAMA_MODEL_FAST);

    if (!result || result.length === 0) {
        console.log('[Parser] Fast model failed or empty, no result');
        return [];
    }

    // 後處理：修正 LLM 算錯的數字
    result = result.map(fixNumbersFromRaw);

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
