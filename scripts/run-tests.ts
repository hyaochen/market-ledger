// 跨平台測試入口：先設好測試用環境變數，再用 tsx 跑所有 .test.ts
// 用 npm run test 呼叫，不需要 cross-env / dotenv
import { spawn } from "node:child_process";

// 用 bracket access 繞開 Next.js 對 NODE_ENV 的唯讀型別限制
const env = process.env as Record<string, string | undefined>;
env.SESSION_SECRET = env.SESSION_SECRET || "a".repeat(40);
env.NODE_ENV = "test";

const tests = [
    "bot/parser.test.ts",
    "bot/itemKeywords.test.ts",
    "src/lib/password.test.ts",
    "src/lib/session.test.ts",
];

const child = spawn("tsx", ["--test", ...tests], {
    stdio: "inherit",
    env: process.env,
    shell: true,
});
child.on("exit", (code) => process.exit(code ?? 1));
