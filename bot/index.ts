// Telegram Bot 主入口（polling 模式）
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { preloadStates } from './state';
import { runStartupBridgeHealthCheck } from './bridgeHealth';
import { startHeartbeat } from './heartbeat';
import { handleMessage } from './handlers/message';
import { handleCallback } from './handlers/callback';
import { pruneStaleThrottleRows } from './loginThrottle';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN 未設定，請檢查 .env');
    process.exit(1);
}

// T-ML-031：容器健康檢查心跳。跟 Telegram polling 能不能啟動成功無關，故意放在
// bot 物件建立之前就開始跑，越早開始寫心跳檔越好（細節見 bot/heartbeat.ts 檔頭註解）。
startHeartbeat();

// 啟動前先從 DB 拉回所有對話狀態（撐過 bot 重啟不丟進度）
// autoStart:false 讓我們先載入完狀態再開 polling
const bot = new TelegramBot(TOKEN, {
    polling: {
        interval: 2000,
        autoStart: false,
        params: { timeout: 30 },
    },
});

console.log('Bot 啟動中...');

(async () => {
    await preloadStates();
    // T-ML-026 (B)：啟動時打一次 claude-bridge /health，不通就 Telegram 告警給 owner
    // （isSuperAdmin，見 bot/bridgeHealth.ts）。只在啟動時檢查一次，不在每次解析時檢查
    // ——bot/parser.ts 本來就會每筆訊息無感 fallback 到 ollama，這裡只是加一層「該讓人
    // 知道」，過度告警本身就是一種擾民，所以刻意不做成常駐輪詢。
    await runStartupBridgeHealthCheck({
        sendAlert: async (chatId, text) => { await bot.sendMessage(chatId, text); },
    });
    // 清掉過期的登入節流紀錄；失敗不影響啟動
    await pruneStaleThrottleRows().then(
        (n) => { if (n) console.log(`[bot] pruned ${n} stale login throttle rows`); },
        (err) => console.error('[bot] throttle prune failed:', err),
    );
    await bot.startPolling();
    console.log('Bot polling started');
})().catch((err) => {
    console.error('[bot] startup failed:', err);
    process.exit(1);
});

// 訊息與 callback 的處理邏輯在 bot/handlers/message.ts、bot/handlers/callback.ts
bot.on('message', (msg) => handleMessage(bot, msg));
bot.on('callback_query', (query) => handleCallback(bot, query));

// ── 錯誤處理 ────────────────────────────────────────────────
bot.on('polling_error', (err) => {
    console.error('[Polling Error]', err.message);
});

process.on('unhandledRejection', (err) => {
    console.error('[Unhandled Rejection]', err);
});

console.log('Bot 已啟動（polling 模式）');
