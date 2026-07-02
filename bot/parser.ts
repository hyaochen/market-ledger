// Ollama NLP 解析模組
// 策略：LLM 只負責「文字提取」（品項名、數量、金額），DB 比對由 matcher.ts 負責

import { z } from 'zod';
import type { ParsedEntry, DbContext } from './types';
import { maskKeywordsForLlm, stripCanonicalNumericNames } from './itemKeywords';

// LLM 輸出的單筆結構 — 所有欄位都可選，實務上 LLM 會漏填不常見欄位
const RawExtractedSchema = z.object({
    type: z.string().optional(),
    date: z.string().optional(),
    itemName: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
    price: z.number().optional(),
    vendorName: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    rawInput: z.string().optional(),
}).catchall(z.unknown()); // 容忍多餘欄位

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
2. 識別方式：有重量/數量單位（臺斤/台斤/斤/公斤/kg/個/包/條/份/箱/罐/瓶/顆/袋/桶/組/片）緊接的數字 → quantity；沒有單位的獨立數字 → price
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
- 「6月19號潮州攤位17720」→ {"type":"REVENUE","date":"YYYY-06-19","itemName":"潮州攤位","price":17720}（即使前面有日期，主體仍是攤位名+金額→REVENUE）
- 「6月19號潮州攤位 17720」→ {"type":"REVENUE","date":"YYYY-06-19","itemName":"潮州攤位","price":17720}（中間有空格不影響）
- 「7/15 屏東 12300」→ {"type":"REVENUE","date":"YYYY-07-15","itemName":"屏東","price":12300}
- 「洗碗精12桶560」→ {"type":"EXPENSE","itemName":"洗碗精","quantity":12,"unit":"桶","price":560}
- 「漂白水2桶40」→ {"type":"EXPENSE","itemName":"漂白水","quantity":2,"unit":"桶","price":40}
- 「肝連2.6台斤218廠商海豐」→ {"type":"PURCHASE","itemName":"肝連","quantity":2.6,"unit":"台斤","price":218,"vendorName":"海豐"}
- 「頭皮3個350」→ {"type":"PURCHASE","itemName":"頭皮","quantity":3,"unit":"個","price":350}（食材品項+數量→PURCHASE，不是費用）
- 「3月29號滷蛋600顆500備註測試」→ {"type":"PURCHASE","date":"YYYY-03-29","itemName":"滷蛋","quantity":600,"unit":"顆","price":500,"note":"測試"}

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
                keep_alive: '30m', // 讓 ollama 把模型常駐記憶體 30 分鐘，避免每次 cold start 4.7GB 重 load
                options: { temperature: 0.1, num_predict: 1024 },
            }),
            signal: AbortSignal.timeout(120000), // 2 分鐘：容忍 ollama cold start + GPU 競爭
        });

        console.log(`[Parser] ${model} responded in ${Date.now() - t0}ms, status=${response.status}`);
        if (!response.ok) {
            console.error(`[Parser] HTTP error ${response.status}`);
            return null;
        }
        const data = await response.json() as { message?: { content?: string } };
        let content = data?.message?.content;
        if (!content) {
            console.error('[Parser] Empty content from model');
            return null;
        }

        // qwen3 思考模式會在 JSON 前輸出 <think>...</think>，需要先移除
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        console.log(`[Parser] Raw response: ${content.slice(0, 400)}`);

        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch (err) {
            console.error('[Parser] JSON.parse failed:', err);
            return null;
        }

        let rawArr: unknown[] | null = null;
        if (Array.isArray(parsed)) {
            rawArr = parsed;
        } else if (typeof parsed === 'object' && parsed !== null) {
            for (const val of Object.values(parsed)) {
                if (Array.isArray(val)) { rawArr = val; break; }
            }
        }
        if (!rawArr) {
            if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
                rawArr = [parsed];
                console.log('[Parser] Wrapped single entry object in array');
            } else {
                const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') : typeof parsed;
                console.error('[Parser] No array found. Got:', keys);
                return null;
            }
        }

        // Zod 驗證：過濾掉明顯壞掉的 entry（保留能驗過的）
        const validated: RawExtracted[] = [];
        for (const raw of rawArr) {
            const result = RawExtractedSchema.safeParse(raw);
            if (result.success) {
                validated.push(result.data as RawExtracted);
            } else {
                console.warn('[Parser] Zod rejected entry:', result.error.issues.slice(0, 3));
            }
        }

        console.log(`[Parser] Extracted ${rawArr.length}, validated ${validated.length}`);
        return validated;
    } catch (e) {
        console.error(`[Parser] Failed (${model}) after ${Date.now() - t0}ms:`, e);
        return null;
    }
}

// LLM 輸出的原始結構（不含 DB ID）— schema 定義在檔案頂部
type RawExtracted = z.infer<typeof RawExtractedSchema>;

// 量詞單位（重量/數量）— 不含貨幣詞
const QTY_UNITS = ['臺斤', '台斤', '公斤', '斤', 'kg', 'KG', 'g', 'G', '個', '包', '條', '份', '箱', '罐', '瓶', '桶', '組', '片', '顆', '克', '袋'];
const QTY_UNIT_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${QTY_UNITS.join('|')})`, 'g');
const CHINESE_NUM: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const CN_QTY_UNIT_RE = new RegExp(`([一兩二三四五六七八九十])\\s*(${QTY_UNITS.join('|')})`, 'g');

// 斤兩格式：「2斤10兩」→ quantity=210, unit='jl'（1斤=16兩，16進位）
const JIN_LIANG_RE = /(\d+)斤(\d+)兩/;

// ── 休假/公休意圖 pre-LLM 偵測 ─────────────────────────────────────────────
// 員工常會把「潮州 5/23 休假」「屏東今天休息」直接打給 bot，這類輸入
// 用 LLM 反而容易誤判成 EXPENSE（休假費）；regex 預判穩定且不耗 token。
// 任一行不符合休假模式則回 null，讓整批走原本 LLM 流程。
// T-ML-018：擴充 keyword 含「休息」，並把備註欄填「{攤位名}公休」（不再 null）
const DAY_OFF_RE = /休息|休假|公休/;
export function detectDayOffEntries(input: string, today: string, locationNames: string[]): ParsedEntry[] | null {
    const text = normalizeNumbers(input);
    if (!DAY_OFF_RE.test(text)) return null;

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const result: ParsedEntry[] = [];
    for (const line of lines) {
        if (!DAY_OFF_RE.test(line)) return null; // 混雜非休假行 → 走 LLM
        // 不接受同行含金額（避免「潮州5000休息」這種模糊輸入直接認定）
        const hasPrice = /\d{3,}/.test(line.replace(/\d+[月\/]\d+[日號]?/g, ''));
        if (hasPrice) return null;

        // 抓日期（支援 M/D、M月D日/號；找不到 → 今日）
        let date = today;
        const dateMatch = line.match(/(\d{1,2})[月\/](\d{1,2})[日號]?/);
        if (dateMatch) {
            const month = parseInt(dateMatch[1], 10);
            const day = parseInt(dateMatch[2], 10);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                const [y] = today.split('-');
                date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }

        // 抓 location：先 exact match 已知地點，再 fallback 抽休假關鍵字前的中文段
        let locationName: string | null = null;
        for (const name of locationNames) {
            if (line.includes(name)) { locationName = name; break; }
        }
        if (!locationName) {
            const cleaned = line
                .replace(/\d+[月\/]\d+[日號]?/g, '')
                .replace(/今天|今日|本日/g, '')
                .replace(/休息|休假|公休/g, '')
                .trim();
            if (cleaned) locationName = cleaned;
        }
        if (!locationName) return null;

        result.push({
            type: 'REVENUE',
            date,
            itemId: null,
            itemName: null,
            expenseType: null,
            locationId: null,
            locationName,
            isDayOff: true,
            quantity: null,
            unit: null,
            price: 0,
            vendorId: null,
            vendorName: null,
            note: `${locationName}公休`,
            confident: true,
            uncertainReason: null,
            rawInput: line,
        });
    }

    return result.length > 0 ? result : null;
}

/** 若 rawInput 含「X斤Y兩」格式，將 entry 的 quantity/unit 換成 jl 編碼（覆蓋 LLM 結果） */
export function fixJinLiangFromRaw(entry: RawExtracted): RawExtracted {
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
export function normalizeNumbers(text: string): string {
    return text.replace(/(\d+)[\u02CB,ˋ](\d{3})/g, '$1$2');
}

// 中文數字對照表
const CN_DIGIT: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

// 解析中文數字字串為阿拉伯數字（支援 個位/十位）
export function parseCnNumber(s: string): number | null {
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
export function convertChineseNumbers(text: string): string {
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
// T-ML-018：先把已 mask 的數字 keyword 標準名（「大骨高湯1600」）整段拿掉，
// 否則尾巴的 1600/1601 會被誤抓為 price，蓋掉 LLM 正確的 null/0
export function fixNumbersFromRaw(entry: RawExtracted): RawExtracted {
    // jl 已由 fixJinLiangFromRaw 處理完畢，跳過此步驟
    if (entry.unit === 'jl') return entry;

    const raw = stripCanonicalNumericNames(normalizeNumbers(entry.rawInput ?? ''));

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

/** LLM 漏掉備註時，從 rawInput 中提取「備註XXX」 */
function fixNoteFromRaw(entry: RawExtracted): RawExtracted {
    if (entry.note) return entry; // LLM 已提取，不覆蓋
    const raw = entry.rawInput ?? '';
    const m = raw.match(/備註(.+)/);
    if (m) {
        const note = m[1].trim();
        console.log(`[Parser] Note fix from raw: "${note}"`);
        return { ...entry, note };
    }
    return entry;
}

/** LLM 誤判 EXPENSE 但 rawInput 含有數量+單位 → 改為 PURCHASE，並從原文重新提取品項名 */
function fixMisclassifiedExpense(entry: RawExtracted): RawExtracted {
    if (entry.type !== 'EXPENSE') return entry;
    const raw = normalizeNumbers(entry.rawInput ?? '');
    // 檢查 rawInput 是否含有數量+單位（食材特徵）
    const qtyMatch = raw.match(QTY_UNIT_RE);
    if (!qtyMatch) return entry;
    // 已知費用關鍵字不修正
    const expenseKeywords = ['薪資', '清潔費', '停車費', '油費', '洗攤', '洗碗精', '電費', '租金', '瓦斯', '漂白水', '打火機', '雜支', '幫提圈', '半斤內袋', '泉水', '塑膠袋'];
    const rawClean = raw.replace(/\d+/g, '').replace(/[月號日\/]/g, '');
    if (expenseKeywords.some(kw => rawClean.includes(kw))) return entry;
    // 從 rawInput 提取品項名：去掉日期、數字+單位、備註、廠商
    const itemName = raw
        .replace(/\d{1,2}[月\/]\d{1,2}[日號]?/g, '')  // 去日期
        .replace(/備註.*/g, '')                          // 去備註及之後
        .replace(/廠商.*/g, '')                          // 去廠商及之後
        .replace(QTY_UNIT_RE, '')                        // 去數量+單位
        .replace(/\d+/g, '')                             // 去獨立數字
        .trim();
    if (itemName) {
        console.log(`[Parser] EXPENSE→PURCHASE fix: "${raw}" → itemName="${itemName}"`);
        return { ...entry, type: 'PURCHASE', itemName };
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

    // 休假意圖優先攔截（pre-LLM）— 命中即整批回，不走 Ollama
    const dayOffEntries = detectDayOffEntries(userText, today, locationNames);
    if (dayOffEntries && dayOffEntries.length > 0) {
        console.log(`[Parser] DAY_OFF pattern matched: ${dayOffEntries.length} entry`);
        return dayOffEntries;
    }

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

    // T-ML-018：對 LLM 輸入做關鍵字 mask（味精→味鮮A、1600→大骨高湯1600 等），
    // 數字 keyword 不 mask 會被 LLM 當成 price。rawInput 後續 post-process 也用 mask 版本。
    const maskedText = maskKeywordsForLlm(normalizedText);
    let result = await callOllama(systemPrompt, maskedText, OLLAMA_MODEL_FAST);

    if (!result || result.length === 0) {
        console.log('[Parser] Fast model failed or empty, no result');
        return [];
    }

    // 多行輸入但 LLM 只回傳 1 筆 → 逐行重新解析補漏
    if (isMultiLine && result.length < inputLines.length) {
        console.log(`[Parser] Multi-line input (${inputLines.length} lines) but only got ${result.length} entry, retrying per-line`);
        const perLineResults: RawExtracted[] = [];
        for (const line of inputLines) {
            const maskedLine = maskKeywordsForLlm(line);
            const lineResult = await callOllama(systemPrompt, maskedLine, OLLAMA_MODEL_FAST);
            if (lineResult && lineResult.length > 0) {
                // rawInput 用 maskedLine 而非 line，post-process（含 stripCanonicalNumericNames）才一致
                perLineResults.push(...lineResult.map(e => ({ ...e, rawInput: e.rawInput ?? maskedLine })));
            }
        }
        if (perLineResults.length > result.length) {
            console.log(`[Parser] Per-line retry got ${perLineResults.length} entries`);
            result = perLineResults;
        }
    }

    // 後處理：先補 rawInput fallback，確保 fixJinLiangFromRaw 可靠讀到原始文字
    // B1 fix：LLM 省略 rawInput 欄位時，fallback 至 maskedText（含品項 keyword 置換版本），
    // 讓 JIN_LIANG_RE 能從原始文字正確提取「X斤Y兩」，不再誤讀 LLM 的小數格式
    result = result
        .map(e => ({ ...e, rawInput: e.rawInput ?? maskedText }))
        .map(fixJinLiangFromRaw).map(fixNumbersFromRaw).map(normalizeUnit).map(fixExpenseAmountField).map(fixRevenueFromNote).map(fixMisclassifiedExpense).map(fixNoteFromRaw);

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
            // T-ML-018：fallback 用 maskedText（含已置換的標準品項名）
            // 而非原文 userText，post-process 才看得到正確的「大骨高湯1600」整段
            rawInput: entry.rawInput ?? maskedText,
        };
    });
}
