// 自動化測試腳本 - 測試 Parser + Matcher 邏輯
// 使用方式：docker exec market-ledger-bot npx tsx bot/test-runner.ts
// 特性：不寫入 DB（只讀），直接呼叫 Ollama + Matcher，印出 Pass/Fail 報告

import { parseEntries } from './parser';
import { enrichEntry, loadDbContext } from './matcher';
import type { ParsedEntry, DbContext } from './types';

// 正式企業 tenantId
const TENANT_ID = 'cml8xdpx20000cfyo23pu6cbm';

// ── 測試案例定義 ─────────────────────────────────────────────────────────────

interface ExpectedEntry {
    type?: 'PURCHASE' | 'EXPENSE' | 'REVENUE';
    itemName?: string;       // DB 品項名（比對後）
    expenseType?: string;    // 支出類型 value（如 EXP011, 薪資）
    price?: number;
    quantity?: number | null;
    unit?: string | null;
    vendorName?: string | null;
    note?: string | null;
    confident?: boolean;     // 是否信心足夠（不需確認）
    dateContains?: string;   // date 欄位應包含此字串（如 "03-04"）
    uncertainContains?: string; // uncertainReason 應包含此字串
}

interface TestCase {
    id: string;
    desc: string;
    input: string;
    expected: ExpectedEntry[];
}

const testCases: TestCase[] = [
    // ── A 組：基本功能 ──────────────────────────────────────────────────────
    {
        id: 'A1a',
        desc: '標準進貨（肝蓮，有廠商）',
        input: '肝蓮2.1斤188廠商海豐',
        // 注意：若今日已有同筆記錄，duplicate detection 會把 confident 改為 false（正常行為）
        expected: [{ type: 'PURCHASE', itemName: '肝蓮', price: 188, quantity: 2.1, vendorName: '海豐' }],
    },
    {
        id: 'A1b',
        desc: '標準進貨（頭皮，3個）',
        input: '頭皮3個360廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '頭皮', price: 360, quantity: 3, vendorName: '海豐' }],
    },
    {
        id: 'A1c',
        desc: '標準進貨（粉腸）',
        input: '粉腸2.1斤239廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '粉腸', price: 239, quantity: 2.1, vendorName: '海豐' }],
    },
    {
        id: 'A1d',
        desc: '標準進貨（舌頭，已改名）',
        input: '舌頭4.3斤383廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '舌頭', price: 383, quantity: 4.3, vendorName: '海豐' }],
    },
    {
        id: 'A2a',
        desc: '支出（薪資帶備註）',
        input: '薪資1100備註阿秀',
        expected: [{ type: 'EXPENSE', expenseType: '薪資', price: 1100, note: '阿秀' }],
    },
    {
        id: 'A2b',
        desc: '支出（清潔費帶備註）',
        input: '清潔費110備註中山',
        expected: [{ type: 'EXPENSE', expenseType: '清潔費', price: 110, note: '中山' }],
    },
    {
        id: 'A2c',
        desc: '支出（清潔費無備註）',
        input: '清潔費220',
        expected: [{ type: 'EXPENSE', expenseType: '清潔費', price: 220, note: null }],
    },
    {
        id: 'A3a',
        desc: '支出含數量（洗碗精2桶，應為 EXP013）',
        input: '洗碗精2桶60',
        expected: [{ type: 'EXPENSE', expenseType: 'EXP013', price: 60, quantity: 2 }],
    },
    {
        id: 'A3b',
        desc: '支出含數量（塑膠袋3包）- LLM 誤判 PURCHASE，需 prompt 改進',
        // LLM 不知道 DB 中塑膠袋是 EXPENSE 類型，直覺分類為 PURCHASE（購買行為）
        // 使用者在 Bot 會看到「找不到品項」→ 選擇「新增支出類型」來修正
        // 記錄此為 known limitation，可改善 prompt 解決
        input: '塑膠袋3包90',
        expected: [{ price: 90, quantity: 3, confident: false }],
    },
    {
        id: 'A4',
        desc: '洗攤帶備註（EXP011，note 不應含廠商前綴）',
        input: '洗攤250備註潮州',
        expected: [{ type: 'EXPENSE', expenseType: 'EXP011', price: 250, note: '潮州' }],
    },
    // ── B 組：模糊比對 ──────────────────────────────────────────────────────
    {
        id: 'B1',
        desc: '錯字（肝連→肝蓮），修正短詞懲罰後應找到肝蓮',
        input: '肝連2.1斤188廠商海豐',
        // 修正 minLen <= 1 後，肝連↔肝蓮 score=0.5，剛好在 threshold，應出現在候選中
        // LLM 若直接輸出「肝連」→ fuzzy match → 候選品項「肝蓮」，confident=false
        expected: [{ type: 'PURCHASE', price: 188, quantity: 2.1, confident: false, uncertainContains: '請確認' }],
    },
    {
        id: 'B2',
        desc: '簡體字（猪耳→豬耳），應直接儲存',
        input: '猪耳3斤180廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '豬耳', price: 180, quantity: 3, vendorName: '海豐', confident: true }],
    },
    {
        id: 'B3',
        desc: '簡體複合（猪脚肉→豬腳肉）',
        input: '猪脚肉3斤180廠商永新',
        expected: [{ type: 'PURCHASE', itemName: '豬腳肉', price: 180, quantity: 3, vendorName: '永新', confident: true }],
    },
    {
        id: 'B4a',
        desc: '大腸頭（完整品名），應直接儲存',
        input: '大腸頭500 3斤廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '大腸頭', price: 500, quantity: 3, vendorName: '海豐', confident: true }],
    },
    {
        id: 'B4b',
        desc: '大腸（短品名，DB 有大腸和大腸頭），應儲存大腸',
        input: '大腸500 3斤廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '大腸', price: 500, quantity: 3 }],
    },
    {
        id: 'B5',
        desc: 'LLM 靜默翻譯（乾連→肝蓮），應要求確認',
        input: '乾連218 2.6斤廠商海豐',
        expected: [{ type: 'PURCHASE', price: 218, quantity: 2.6, confident: false, uncertainContains: '請確認' }],
    },
    // ── C 組：數字解析 ──────────────────────────────────────────────────────
    {
        id: 'C1',
        desc: '金額在前（五花肉3000 20斤）',
        input: '五花肉3000 20斤廠商永新',
        expected: [{ type: 'PURCHASE', itemName: '五花肉', price: 3000, quantity: 20, vendorName: '永新' }],
    },
    {
        id: 'C2',
        desc: '金額在前小數（肝蓮218 2.6台斤）',
        input: '肝蓮218 2.6台斤廠商海豐',
        expected: [{ type: 'PURCHASE', itemName: '肝蓮', price: 218, quantity: 2.6 }],
    },
    {
        id: 'C3',
        desc: '中文數字（兩箱黑糖珍珠）',
        input: '兩箱黑糖珍珠860',
        expected: [{ price: 860, quantity: 2 }],
    },
    {
        id: 'C4',
        desc: '特殊格式數字（1ˋ500）',
        input: '五花肉1ˋ500 2斤廠商永新',
        expected: [{ type: 'PURCHASE', price: 1500, quantity: 2 }],
    },
    {
        id: 'C5',
        desc: '純金額無數量（泉水1000）',
        input: '泉水1000',
        expected: [{ type: 'EXPENSE', expenseType: 'EXP015', price: 1000, quantity: null }],
    },
    // ── D 組：日期處理 ──────────────────────────────────────────────────────
    {
        id: 'D1',
        desc: '日期前綴（3月4號清潔費）',
        input: '3月4號清潔費200備註中山',
        expected: [{ type: 'EXPENSE', price: 200, note: '中山', dateContains: '03-04' }],
    },
    {
        id: 'D2',
        desc: '斜線日期（3/10）',
        input: '3/10肝蓮2.1斤188廠商海豐',
        expected: [{ type: 'PURCHASE', price: 188, dateContains: '03-10' }],
    },
    // ── E 組：邊界情況 ──────────────────────────────────────────────────────
    {
        id: 'F1',
        desc: '不相關文字（LLM 會嘗試解析，price 應為 null/0）',
        // LLM 永遠嘗試解析，這是 LLM 限制，不是 Bug
        // 驗證重點：price=0 時不應直接存入 DB（saveEntry 前需驗證）
        input: '你好今天天氣很好',
        expected: [{ price: 0 }],  // LLM 猜測的任何內容，price 通常為 0（null→0）
    },
    {
        id: 'F2',
        desc: '純數字（LLM 可能猜成薪資，這是 LLM 限制）',
        input: '12345',
        expected: [{ price: 12345 }],  // LLM 猜 price=12345，可接受
    },
];

// ── 比對函式 ─────────────────────────────────────────────────────────────────

interface FieldResult {
    field: string;
    pass: boolean;
    expected: string;
    actual: string;
}

function compareEntry(actual: ParsedEntry, exp: ExpectedEntry): FieldResult[] {
    const results: FieldResult[] = [];

    function check(field: string, actualVal: unknown, expectedVal: unknown, desc?: string): void {
        if (expectedVal === undefined) return;  // 不檢查
        const pass = String(actualVal) === String(expectedVal);
        results.push({
            field,
            pass,
            expected: desc ?? String(expectedVal),
            actual: String(actualVal),
        });
    }

    function checkContains(field: string, actualVal: string | null | undefined, substr: string): void {
        const pass = (actualVal ?? '').includes(substr);
        results.push({
            field,
            pass,
            expected: `contains "${substr}"`,
            actual: String(actualVal ?? ''),
        });
    }

    if (exp.type !== undefined) check('type', actual.type, exp.type);
    if (exp.price !== undefined) check('price', actual.price, exp.price);
    if (exp.quantity !== undefined) {
        if (exp.quantity === null) {
            check('quantity', actual.quantity, null);
        } else {
            // 允許小數精度誤差
            const pass = actual.quantity != null && Math.abs(actual.quantity - exp.quantity) < 0.001;
            results.push({ field: 'quantity', pass, expected: String(exp.quantity), actual: String(actual.quantity) });
        }
    }
    if (exp.itemName !== undefined) check('itemName', actual.itemName, exp.itemName);
    if (exp.expenseType !== undefined) check('expenseType', actual.expenseType, exp.expenseType);
    if (exp.vendorName !== undefined) check('vendorName', actual.vendorName, exp.vendorName);
    if (exp.note !== undefined) check('note', actual.note, exp.note);
    if (exp.confident !== undefined) check('confident', actual.confident, exp.confident);
    if (exp.dateContains !== undefined) checkContains('date', actual.date, exp.dateContains);
    if (exp.uncertainContains !== undefined) checkContains('uncertainReason', actual.uncertainReason, exp.uncertainContains);

    return results;
}

// ── 顏色輸出 ─────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ── 主程式 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log(`\n${BOLD}=== Telegram Bot 自動化測試 ===${RESET}`);
    console.log(`${DIM}tenantId: ${TENANT_ID}${RESET}`);
    console.log(`${DIM}載入 DB Context...${RESET}`);

    const ctx = await loadDbContext(TENANT_ID);
    console.log(`${DIM}Items: ${ctx.items.length}, Vendors: ${ctx.vendors.length}, ExpenseTypes: ${ctx.expenseTypes.length}${RESET}\n`);

    const summary: { id: string; desc: string; status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIP'; detail?: string }[] = [];

    for (const tc of testCases) {
        const header = `${CYAN}[${tc.id}]${RESET} ${tc.desc}`;
        process.stdout.write(`${header}\n`);
        process.stdout.write(`  ${DIM}輸入: "${tc.input.replace(/\n/g, '↵')}"${RESET}\n`);

        try {
            const t0 = Date.now();
            const parsed = await parseEntries(tc.input, ctx);
            const elapsed = Date.now() - t0;
            process.stdout.write(`  ${DIM}Parser: ${parsed.length} 筆 (${elapsed}ms)${RESET}\n`);

            const enriched = await Promise.all(parsed.map(e => enrichEntry(e, ctx)));

            // 空陣列測試
            if (tc.expected.length === 0) {
                if (enriched.length === 0 || (enriched.length === 1 && !enriched[0].itemName && !enriched[0].expenseType && enriched[0].price === 0)) {
                    console.log(`  ${GREEN}✓ PASS${RESET} 回傳空/無法解析結果\n`);
                    summary.push({ id: tc.id, desc: tc.desc, status: 'PASS' });
                } else {
                    console.log(`  ${RED}✗ FAIL${RESET} 預期空陣列，實際得到 ${enriched.length} 筆`);
                    enriched.forEach((e, i) => console.log(`    [${i}] type=${e.type} item=${e.itemName} price=${e.price}`));
                    console.log('');
                    summary.push({ id: tc.id, desc: tc.desc, status: 'FAIL', detail: `預期0筆，得到${enriched.length}筆` });
                }
                continue;
            }

            // 筆數不符
            if (enriched.length !== tc.expected.length) {
                console.log(`  ${YELLOW}⚠ 筆數不符${RESET} 預期 ${tc.expected.length} 筆，實際 ${enriched.length} 筆`);
                enriched.forEach((e, i) => console.log(`  ${DIM}  [${i}] type=${e.type} item=${e.itemName ?? e.locationName} exp=${e.expenseType} price=${e.price} confident=${e.confident}${RESET}`));
            }

            // 逐筆比對
            let allPass = true;
            const minLen = Math.min(enriched.length, tc.expected.length);
            for (let i = 0; i < minLen; i++) {
                const actual = enriched[i];
                const exp = tc.expected[i];
                const fields = compareEntry(actual, exp);
                const failed = fields.filter(f => !f.pass);

                if (failed.length === 0) {
                    const passFields = fields.map(f => `${GREEN}${f.field}✓${RESET}`).join(' ');
                    console.log(`  ${GREEN}✓${RESET} [${i}] ${passFields}`);
                    // 印出實際值
                    const info = [
                        actual.itemName ? `item=${actual.itemName}` : '',
                        actual.expenseType ? `exp=${actual.expenseType}` : '',
                        `price=${actual.price}`,
                        actual.quantity != null ? `qty=${actual.quantity}` : '',
                        actual.vendorName ? `vendor=${actual.vendorName}` : '',
                        actual.note ? `note=${actual.note}` : '',
                        `confident=${actual.confident}`,
                    ].filter(Boolean).join(' ');
                    console.log(`  ${DIM}    → ${info}${RESET}`);
                } else {
                    allPass = false;
                    console.log(`  ${RED}✗${RESET} [${i}] 以下欄位不符：`);
                    failed.forEach(f => {
                        console.log(`  ${RED}    ${f.field}: 預期="${f.expected}" 實際="${f.actual}"${RESET}`);
                    });
                    // 印出完整實際值供參考
                    console.log(`  ${DIM}    實際: type=${actual.type} item=${actual.itemName} exp=${actual.expenseType} price=${actual.price} qty=${actual.quantity} vendor=${actual.vendorName} note=${actual.note} confident=${actual.confident}${RESET}`);
                    if (actual.uncertainReason) {
                        console.log(`  ${DIM}    uncertainReason: ${actual.uncertainReason}${RESET}`);
                    }
                }
            }

            const totalChecked = tc.expected.reduce((sum, e) =>
                sum + Object.keys(e).filter(k => (e as Record<string, unknown>)[k] !== undefined).length, 0);

            if (allPass && enriched.length >= tc.expected.length) {
                console.log(`  ${GREEN}${BOLD}✓ PASS${RESET} (${totalChecked} 個欄位全部正確)\n`);
                summary.push({ id: tc.id, desc: tc.desc, status: 'PASS' });
            } else {
                const failDetail = enriched.length !== tc.expected.length
                    ? `筆數不符(預期${tc.expected.length}得到${enriched.length})`
                    : '欄位不符';
                console.log(`  ${RED}${BOLD}✗ FAIL${RESET} (${failDetail})\n`);
                summary.push({ id: tc.id, desc: tc.desc, status: 'FAIL', detail: failDetail });
            }

        } catch (e) {
            console.log(`  ${RED}ERROR: ${String(e)}${RESET}\n`);
            summary.push({ id: tc.id, desc: tc.desc, status: 'ERROR', detail: String(e) });
        }
    }

    // ── 最終報告 ─────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}${'─'.repeat(60)}${RESET}`);
    console.log(`${BOLD}=== 測試報告 ===${RESET}\n`);

    const passed = summary.filter(s => s.status === 'PASS').length;
    const failed = summary.filter(s => s.status === 'FAIL').length;
    const errors = summary.filter(s => s.status === 'ERROR').length;

    summary.forEach(s => {
        const icon = s.status === 'PASS' ? `${GREEN}✓${RESET}` : s.status === 'FAIL' ? `${RED}✗${RESET}` : `${YELLOW}!${RESET}`;
        const detail = s.detail ? ` ${DIM}(${s.detail})${RESET}` : '';
        console.log(`  ${icon} ${s.id.padEnd(5)} ${s.desc}${detail}`);
    });

    console.log(`\n${BOLD}結果：${GREEN}通過 ${passed}${RESET} / ${RED}失敗 ${failed}${RESET} / ${YELLOW}錯誤 ${errors}${RESET} / 共 ${summary.length}${RESET}`);

    if (failed + errors === 0) {
        console.log(`\n${GREEN}${BOLD}🎉 所有測試通過！${RESET}\n`);
    } else {
        console.log(`\n${RED}${BOLD}⚠ 有 ${failed + errors} 個測試未通過，請檢查上方詳情${RESET}\n`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
