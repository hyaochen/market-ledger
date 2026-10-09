// Jev (TypeSafe System One) 品項口語 -> 標準品項快速判斷
// owner 2026-10-09 指示：跳過 200 則門檻直接上線，且一律 fail-open。
//
// 用途：LLM 解析 + matcher 之後，PURCHASE 仍找不到品項（或有多個相似候選）時，
// 用 Jev choice 把使用者口語品項名對到該 tenant 的完整品項表（外加 other = 不確定）。
// 不取代 LLM 解析器。高信心才採用；低信心 / other / 任何錯誤 -> 走原本確認流程。
//
// Fail-open：未設 key、逾時（預設 1500ms）、401/402/429/5xx、回應格式不對、網路錯誤，
// 一律回傳 adopted=false 並 console.warn 一行，絕不拋錯、絕不卡住記帳。
// API key 只從環境變數讀取，永遠不 log。

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const OTHER_KEY = 'other';
const MAX_OPTIONS = 255;

export interface JevItemResult {
    /** ok = 有拿到判斷；skipped = 沒呼叫（無 key / 選項過多）；fail_open = 呼叫失敗已靜默退回 */
    status: 'ok' | 'skipped' | 'fail_open';
    /** 高信心且選了真實品項 */
    adopted: boolean;
    choice: string | null;
    confidence: number | null;
    latencyMs: number;
    reason?: string;
}

export interface JevOptions {
    apiKey?: string;
    timeoutMs?: number;
    minConfidence?: number;
    url?: string;
    fetchImpl?: typeof fetch;
}

function readNumberEnv(name: string, fallback: number): number {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function jevMatchItem(
    originalText: string,
    colloquialName: string,
    itemNames: string[],
    opts: JevOptions = {},
): Promise<JevItemResult> {
    const started = Date.now();
    const done = (r: Omit<JevItemResult, 'latencyMs'>): JevItemResult => ({ ...r, latencyMs: Date.now() - started });

    const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) return done({ status: 'skipped', adopted: false, choice: null, confidence: null, reason: 'no_key' });
    const names = [...new Set(itemNames.filter(n => n && n !== OTHER_KEY))];
    if (names.length === 0 || names.length >= MAX_OPTIONS) {
        return done({ status: 'skipped', adopted: false, choice: null, confidence: null, reason: 'option_count' });
    }

    const timeoutMs = opts.timeoutMs ?? readNumberEnv('JEV_TIMEOUT_MS', 1500);
    const minConfidence = opts.minConfidence ?? readNumberEnv('JEV_MIN_CONFIDENCE', 0.9);
    const doFetch = opts.fetchImpl ?? fetch;

    const criteria: Record<string, string> = {};
    for (const n of names) criteria[n] = `標準品項「${n}」`;
    criteria[OTHER_KEY] = '以上都不是，或無法確定使用者指的是哪個品項';

    const body = {
        model: 'jev-latest',
        state: `使用者在記帳 Telegram bot 輸入：${originalText}\n其中的品項說法是：${colloquialName}`,
        questions: {
            item: {
                type: 'choice',
                instructions: '使用者說的這個品項，對應下列哪一個標準品項？不確定就選 other。',
                criteria,
            },
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await doFetch(opts.url ?? JEV_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn(`[Jev] fail-open: HTTP ${res.status}`);
            return done({ status: 'fail_open', adopted: false, choice: null, confidence: null, reason: `http_${res.status}` });
        }
        const resp = await res.json() as Record<string, unknown>;
        const payload = (resp && typeof resp === 'object' && 'result' in resp ? resp.result : resp) as Record<string, unknown> | undefined;
        const answers = payload?.answers as Record<string, { choice?: unknown; confidence?: unknown }> | undefined;
        const a = answers?.item;
        const choice = typeof a?.choice === 'string' ? a.choice : null;
        const confidence = typeof a?.confidence === 'number' ? a.confidence : null;
        if (choice === null || confidence === null) {
            console.warn('[Jev] fail-open: unexpected response shape');
            return done({ status: 'fail_open', adopted: false, choice: null, confidence: null, reason: 'bad_response' });
        }
        const adopted = choice !== OTHER_KEY && names.includes(choice) && confidence >= minConfidence;
        return done({ status: 'ok', adopted, choice, confidence });
    } catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        console.warn(`[Jev] fail-open: ${aborted ? `timeout ${timeoutMs}ms` : (err instanceof Error ? err.message : 'error')}`);
        return done({ status: 'fail_open', adopted: false, choice: null, confidence: null, reason: aborted ? 'timeout' : 'network' });
    } finally {
        clearTimeout(timer);
    }
}
