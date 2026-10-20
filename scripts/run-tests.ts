// 跨平台測試入口：先設好測試用環境變數，再用 tsx 跑所有測試檔
// 用 npm run test 呼叫，不需要 cross-env / dotenv
//
// T-ML-037: 測試檔改為自動探索（bot/ src/ scripts/ 底下所有 *.test.ts / *.test.js），
// 不再維護手寫清單，避免新增測試檔忘了登記而從未被執行。
// 環境變數 TEST_SKIP_DB=1 時，略過會用到真實 DB 的測試（CI 用，見 DB_TESTS）。
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// 用 bracket access 繞開 Next.js 對 NODE_ENV 的唯讀型別限制
const env = process.env as Record<string, string | undefined>;
env.SESSION_SECRET = env.SESSION_SECRET || "a".repeat(40);
env.NODE_ENV = "test";

const ROOTS = ["bot", "src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "docker-data", "data"]);

// 需要真實 DB（DATABASE_URL 指向有資料的 dev.db）的測試；TEST_SKIP_DB=1 時略過。
// 清單由「DATABASE_URL 指向不存在的檔案時失敗」實測得出，新增依賴 DB 的測試請補在這裡。
const DB_TESTS = new Set<string>([
    "src/lib/analytics/anomalies.test.ts",
    "src/lib/analytics/classifyExpense.test.ts",
    "src/lib/analytics/classifyPurchase.test.ts",
    "src/lib/analytics/classifyStall.test.ts",
    "src/lib/analytics/fixedExpenseRules.test.ts",
    "src/lib/analytics/itemSearch.test.ts",
    "src/lib/analytics/noteSearch.test.ts",
    "src/lib/analytics/periodCompare.test.ts",
    "src/lib/analytics/priceTrend.test.ts",
    "src/lib/analytics/stallProfit.test.ts",
    "src/lib/analytics/vendorCompare.test.ts",
    "src/lib/cashExpenseSync.test.ts",
]);

function walk(dir: string, out: string[]) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name)) walk(join(dir, ent.name), out);
        } else if (/\.test\.(ts|js)$/.test(ent.name)) {
            out.push(join(dir, ent.name).split("\\").join("/"));
        }
    }
}

const found: string[] = [];
for (const r of ROOTS) {
    try { walk(r, found); } catch { /* root missing */ }
}
found.sort();
const tests = env.TEST_SKIP_DB === "1" ? found.filter((f) => !DB_TESTS.has(f)) : found;
console.log(`[run-tests] ${tests.length} test files${env.TEST_SKIP_DB === "1" ? " (DB tests skipped)" : ""}`);

const child = spawn("tsx", ["--test", ...tests], {
    stdio: "inherit",
    env: process.env,
    shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
