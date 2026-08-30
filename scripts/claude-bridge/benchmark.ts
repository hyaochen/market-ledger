// T-ML-024 速度實測：claude bridge vs ollama，10 個真實記帳輸入樣本，各跑 3 次取中位數。
// 走真正的 production 路徑（parseEntries()，含完整 post-process），不是直接打 API。
//
// 用法：
//   npx tsx scripts/claude-bridge/benchmark.ts
//
// 前置：
//   1. claude-bridge 要先啟動（npm run claude-bridge），預設打 http://127.0.0.1:5055
//   2. host 上的 ollama 要在跑（預設 http://localhost:11434）
//
// 輸出：純文字表格（p50 / p95 / cold vs warm）+ 每筆解析結果的正確性比對，
// 直接印到 stdout，不寫檔案（一次性量測工具，結果會被複製進 vault report）。

import { parseEntries } from '../../bot/parser';
import type { DbContext } from '../../bot/types';

const CTX: DbContext = {
    tenantId: 'benchmark',
    categories: [],
    items: [],
    vendors: [],
    expenseTypes: [],
    units: [],
    locations: [
        { id: 'loc-pingtung', name: '屏東' },
        { id: 'loc-chaozhou', name: '潮州' },
        { id: 'loc-zhongshan', name: '中山' },
    ],
};

// 10 個真實記帳輸入樣本：涵蓋 PURCHASE(5) / EXPENSE(3) / REVENUE(2)。
// 全部取自 bot/parser.test.ts 既有 fixture 或 bot/parser.ts system prompt 自帶的 worked example，
// 保證是真實會出現的輸入型態，不是臨時編造。
// 注意：「日期範圍查詢」（如「3月1號到3月31號屏東的總營收」）在 production 是被
// bot/handlers/query.ts 的 regex 攔截，*不會*進到 parseEntries()/LLM，所以不放進這份
// benchmark（放了也只是測到一個生產環境不會發生的路徑，數字沒有意義）。
const SAMPLES: { label: string; text: string; category: 'PURCHASE' | 'EXPENSE' | 'REVENUE' }[] = [
    { label: '豬耳-簡單進貨', text: '豬耳 6公斤 180', category: 'PURCHASE' },
    { label: '肝連-台斤+廠商', text: '肝連2.6台斤218廠商海豐', category: 'PURCHASE' },
    { label: '肝連-斤兩格式', text: '肝連2斤10兩250廠商海豐', category: 'PURCHASE' },
    { label: '滷蛋-日期+備註', text: '3月29號滷蛋600顆500備註測試', category: 'PURCHASE' },
    { label: '頭皮-數量+個', text: '頭皮3個350', category: 'PURCHASE' },
    { label: '清潔費-中山', text: '清潔費220 中山', category: 'EXPENSE' },
    { label: '清潔費-日期+備註', text: '3月4號清潔費200備註中山', category: 'EXPENSE' },
    { label: '洗攤-備註地名(易誤判)', text: '洗攤250備註潮州', category: 'EXPENSE' },
    { label: '潮州-營業額', text: '潮州3000', category: 'REVENUE' },
    { label: '屏東-日期+營業額', text: '7/15 屏東 12300', category: 'REVENUE' },
];

const RUNS_PER_SAMPLE = 3;

type RunResult = { elapsedMs: number; entries: unknown };

async function runOnce(text: string): Promise<RunResult> {
    const t0 = Date.now();
    const entries = await parseEntries(text, CTX);
    const elapsedMs = Date.now() - t0;
    // 只留下 LLM 語意提取相關欄位做正確性比對（itemId/vendorId 等是 matcher.ts 才填，這裡恆為 null，比對沒意義）
    const trimmed = entries.map((e) => ({
        type: e.type, date: e.date, itemName: e.itemName, quantity: e.quantity,
        unit: e.unit, price: e.price, vendorName: e.vendorName, note: e.note,
    }));
    return { elapsedMs, entries: trimmed };
}

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[idx];
}

async function benchmarkProvider(provider: 'claude' | 'ollama'): Promise<{
    perSample: { label: string; category: string; runs: number[]; median: number; results: unknown[] }[];
    coldFirstCallMs: number;
}> {
    process.env.LLM_PROVIDER = provider;
    console.log(`\n=== Provider: ${provider} ===`);

    // 強制 ollama 進入 cold 狀態（unload model），讓第一筆樣本量到真正的 cold start；
    // claude 每次都是新 subprocess，本來就沒有 warm 這回事，跳過這步。
    if (provider === 'ollama') {
        try {
            await fetch(`${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b', keep_alive: 0 }),
            });
            console.log('[benchmark] ollama model unloaded, next call will be cold');
        } catch (e) {
            console.warn('[benchmark] failed to unload ollama model (continuing anyway):', e);
        }
    }

    const perSample: { label: string; category: string; runs: number[]; median: number; results: unknown[] }[] = [];
    let coldFirstCallMs = -1;

    for (let i = 0; i < SAMPLES.length; i++) {
        const sample = SAMPLES[i];
        const runs: number[] = [];
        const results: unknown[] = [];
        for (let r = 0; r < RUNS_PER_SAMPLE; r++) {
            const { elapsedMs, entries } = await runOnce(sample.text);
            runs.push(elapsedMs);
            results.push(entries);
            if (i === 0 && r === 0) coldFirstCallMs = elapsedMs;
            console.log(`  [${provider}] "${sample.label}" run ${r + 1}/${RUNS_PER_SAMPLE}: ${elapsedMs}ms`);
        }
        perSample.push({ label: sample.label, category: sample.category, runs, median: median(runs), results });
    }

    return { perSample, coldFirstCallMs };
}

function printTable(rows: { label: string; category: string; claudeMedian: number; ollamaMedian: number }[]) {
    console.log('\n### 延遲對照表（p50，單位 ms）\n');
    console.log('| 樣本 | 類型 | claude bridge | ollama | 倍率(claude/ollama) |');
    console.log('|---|---|---:|---:|---:|');
    for (const row of rows) {
        const ratio = (row.claudeMedian / row.ollamaMedian).toFixed(2);
        console.log(`| ${row.label} | ${row.category} | ${row.claudeMedian} | ${row.ollamaMedian} | ${ratio}x |`);
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
    console.log(`Benchmark 開始：${SAMPLES.length} 樣本 × ${RUNS_PER_SAMPLE} 次 × 2 providers = ${SAMPLES.length * RUNS_PER_SAMPLE * 2} 次 LLM 呼叫`);
    console.log(`CLAUDE_BRIDGE_URL=${process.env.CLAUDE_BRIDGE_URL ?? 'http://host.docker.internal:5055 (default; 本機測試請確認有指向 127.0.0.1)'}`);
    console.log(`OLLAMA_BASE_URL=${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434 (default)'}`);

    const claudeResult = await benchmarkProvider('claude');
    const ollamaResult = await benchmarkProvider('ollama');

    const rows = SAMPLES.map((s, i) => ({
        label: s.label,
        category: s.category,
        claudeMedian: claudeResult.perSample[i].median,
        ollamaMedian: ollamaResult.perSample[i].median,
    }));
    printTable(rows);

    const claudeAll = claudeResult.perSample.flatMap((s) => s.runs);
    const ollamaAll = ollamaResult.perSample.flatMap((s) => s.runs);
    console.log('\n### 整體統計（單位 ms）\n');
    console.log(`| Provider | p50 (全部 ${RUNS_PER_SAMPLE * SAMPLES.length} 次) | p95 | cold(第1筆) | warm avg(其餘) |`);
    console.log('|---|---:|---:|---:|---:|');
    const claudeWarm = claudeAll.slice(1);
    const ollamaWarm = ollamaAll.slice(1);
    const avg = (n: number[]) => n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : 0;
    console.log(`| claude bridge | ${median(claudeAll)} | ${p95(claudeAll)} | ${claudeResult.coldFirstCallMs} | ${avg(claudeWarm)} |`);
    console.log(`| ollama | ${median(ollamaAll)} | ${p95(ollamaAll)} | ${ollamaResult.coldFirstCallMs} | ${avg(ollamaWarm)} |`);

    console.log('\n### 解析正確性比對（claude vs ollama，同一輸入的第一次跑）\n');
    let mismatchCount = 0;
    for (let i = 0; i < SAMPLES.length; i++) {
        const claudeEntries = claudeResult.perSample[i].results[0];
        const ollamaEntries = ollamaResult.perSample[i].results[0];
        const same = deepEqual(claudeEntries, ollamaEntries);
        if (!same) {
            mismatchCount++;
            console.log(`  ⚠ 不一致 [${SAMPLES[i].label}] "${SAMPLES[i].text}"`);
            console.log(`    claude: ${JSON.stringify(claudeEntries)}`);
            console.log(`    ollama: ${JSON.stringify(ollamaEntries)}`);
        } else {
            console.log(`  ✔ 一致 [${SAMPLES[i].label}]`);
        }
    }
    console.log(`\n共 ${SAMPLES.length} 樣本，${mismatchCount} 個不一致`);

    const overallClaudeMedian = median(claudeAll);
    const overallOllamaMedian = median(ollamaAll);
    console.log('\n### 結論\n');
    if (overallClaudeMedian > overallOllamaMedian) {
        console.log(`claude bridge 比 ollama 慢：整體 p50 ${overallClaudeMedian}ms vs ${overallOllamaMedian}ms（慢 ${(overallClaudeMedian / overallOllamaMedian).toFixed(2)}x）`);
    } else {
        console.log(`claude bridge 比 ollama 快：整體 p50 ${overallClaudeMedian}ms vs ${overallOllamaMedian}ms`);
    }
}

main().catch((e) => {
    console.error('[benchmark] FATAL', e);
    process.exit(1);
});
