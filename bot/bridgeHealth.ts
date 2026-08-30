// T-ML-026 (B): startup-only health check for the claude-bridge host service, with a
// one-time Telegram alert to the owner if it's down.
//
// Deliberately only ever called ONCE, during bot startup (see bot/index.ts) -- per
// task spec we must NOT re-check on every parseEntries() call, that would be a
// per-message alert spam risk (bot/parser.ts already has its own silent per-call
// fallback to ollama; this module only adds the "somebody should notice" layer on
// top of that, exactly once per bot process lifetime).
//
// The alreadyAlertedThisProcess guard below is a defensive safety net in case this
// function is ever invoked more than once in the same process (e.g. future retry
// logic) -- it is not expected to matter today since bot/index.ts calls it exactly
// once at startup.

import prisma from '../src/lib/prisma';
import type { SessionData } from './types';

const SESSION_KEY_PREFIX = 'tg_session_';

function getLlmProvider(): 'claude' | 'ollama' {
    return (process.env.LLM_PROVIDER ?? 'claude').toLowerCase() === 'ollama' ? 'ollama' : 'claude';
}
function getClaudeBridgeUrl(): string {
    return process.env.CLAUDE_BRIDGE_URL ?? 'http://host.docker.internal:5055';
}

export type BridgeHealthResult = { ok: true } | { ok: false; reason: string };

/**
 * Pure HTTP check against the bridge's /health endpoint. Short timeout on purpose --
 * this runs once at bot startup and must not meaningfully delay bot.startPolling().
 */
export async function checkClaudeBridgeHealth(bridgeUrl: string, timeoutMs = 3000): Promise<BridgeHealthResult> {
    let response: Response;
    try {
        response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
        const err = e as { name?: string; cause?: { code?: string }; message?: string };
        const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        const reason = isTimeout
            ? `timeout>${timeoutMs}ms`
            : `connect-error: ${err?.cause?.code ?? err?.message ?? String(e)}`;
        return { ok: false, reason };
    }
    if (!response.ok) {
        return { ok: false, reason: `http ${response.status}` };
    }
    const body = await response.json().catch(() => null) as { ok?: boolean } | null;
    if (body && body.ok === false) {
        return { ok: false, reason: 'bridge responded but reported ok:false' };
    }
    return { ok: true };
}

/**
 * Find the owner's Telegram chat id by scanning the bot's own logged-in sessions
 * (SystemConfig `tg_session_*` rows -- the same store bot/auth.ts / bot/state.ts
 * already read/write) for one whose linked User has isSuperAdmin === true.
 *
 * For a private Telegram chat, chatId === the Telegram user id used as the session
 * key (bot/state.ts preloadStates() parses the same key suffix the same way), so the
 * returned number can be passed straight to bot.sendMessage(chatId, ...).
 *
 * Deliberately NOT a hardcoded chat id and NOT read from .env -- per task spec, owner
 * identity must come from the bot's existing auth mechanism (the isSuperAdmin flag on
 * User, prisma/schema.prisma:49), not a new config value. Returns null if the owner
 * has never logged into the bot from Telegram (no session to alert through yet) or if
 * the lookup itself fails -- both are non-fatal, just means "can't alert this time".
 */
export async function findOwnerChatId(): Promise<number | null> {
    try {
        const rows = await prisma.systemConfig.findMany({
            where: { key: { startsWith: SESSION_KEY_PREFIX }, tenantId: null },
        });
        for (const row of rows) {
            const chatId = Number(row.key.slice(SESSION_KEY_PREFIX.length));
            if (!Number.isFinite(chatId)) continue;

            let session: SessionData;
            try {
                session = JSON.parse(row.value);
            } catch {
                continue;
            }
            if (!session?.userId) continue;
            if (new Date(session.expires) < new Date()) continue; // expired session, not a live owner chat

            const user = await prisma.user.findUnique({
                where: { id: session.userId },
                select: { isSuperAdmin: true },
            });
            if (user?.isSuperAdmin) return chatId;
        }
        return null;
    } catch (err) {
        console.warn('[bot/bridgeHealth] findOwnerChatId failed (non-fatal):', (err as Error)?.message ?? err);
        return null;
    }
}

/** testPrefix e.g. "[T-ML-026 測試]" so manual verification runs are unmistakably not a real incident. */
export function buildAlertMessage(reason: string, testPrefix: string = ''): string {
    const prefix = testPrefix ? `${testPrefix} ` : '';
    return `${prefix}⚠️ claude-bridge 沒有在跑（${reason}）\n\n`
        + '已自動退回本地 ollama，記帳解析還能用，但正確率會下降（中文/複雜句型較容易判斷錯誤）。\n\n'
        + '請執行：npm run claude-bridge\n'
        + '（或確認開機自啟排程 market-ledger-claude-bridge 有正常啟動，見 scripts/claude-bridge/README.md）';
}

let alreadyAlertedThisProcess = false;

export type HealthCheckDeps = {
    /** Required to actually alert; if omitted, a would-be alert is reported as not-sent instead of throwing. */
    sendAlert?: (chatId: number, text: string) => Promise<void>;
    findOwnerChatId?: () => Promise<number | null>;
    checkHealth?: (bridgeUrl: string, timeoutMs?: number) => Promise<BridgeHealthResult>;
    getProvider?: () => 'claude' | 'ollama';
    getBridgeUrl?: () => string;
    /** e.g. "[T-ML-026 測試]" for manual verification runs, so the message is unmistakably a test. */
    testPrefix?: string;
};

export type HealthCheckOutcome =
    | { skipped: true; reason: string }
    | { skipped: false; healthy: true }
    | { skipped: false; healthy: false; alerted: boolean; alertReason?: string };

/**
 * Orchestration entry point, called once from bot/index.ts startup. Fully
 * dependency-injected so unit tests never touch the real DB / Telegram / network --
 * only checkClaudeBridgeHealth is exercised against a real (local, mocked) HTTP
 * server in tests; findOwnerChatId / sendAlert are swapped for fakes.
 */
export async function runStartupBridgeHealthCheck(deps: HealthCheckDeps = {}): Promise<HealthCheckOutcome> {
    const {
        sendAlert,
        findOwnerChatId: findOwner = findOwnerChatId,
        checkHealth = checkClaudeBridgeHealth,
        getProvider = getLlmProvider,
        getBridgeUrl = getClaudeBridgeUrl,
        testPrefix,
    } = deps;

    if (getProvider() !== 'claude') {
        console.log('[bot/bridgeHealth] LLM_PROVIDER is not claude, skipping bridge health check');
        return { skipped: true, reason: 'LLM_PROVIDER is not claude, bridge not in use' };
    }

    const result = await checkHealth(getBridgeUrl());
    if (result.ok) {
        console.log('[bot/bridgeHealth] claude-bridge healthy at startup');
        return { skipped: false, healthy: true };
    }

    console.warn(`[bot/bridgeHealth] claude-bridge unreachable at startup: ${result.reason}`);

    if (alreadyAlertedThisProcess) {
        // Defensive de-dup only -- see file header. Not expected to trigger in normal operation.
        return { skipped: false, healthy: false, alerted: false, alertReason: 'already alerted this process' };
    }

    const ownerChatId = await findOwner();
    if (ownerChatId == null) {
        console.warn('[bot/bridgeHealth] no owner (isSuperAdmin) Telegram session found, cannot alert');
        return { skipped: false, healthy: false, alerted: false, alertReason: 'no owner chat id available' };
    }

    if (!sendAlert) {
        console.warn('[bot/bridgeHealth] no sendAlert function wired, cannot alert');
        return { skipped: false, healthy: false, alerted: false, alertReason: 'no sendAlert function provided' };
    }

    try {
        await sendAlert(ownerChatId, buildAlertMessage(result.reason, testPrefix));
        alreadyAlertedThisProcess = true;
        return { skipped: false, healthy: false, alerted: true };
    } catch (err) {
        console.warn('[bot/bridgeHealth] sendAlert failed:', (err as Error)?.message ?? err);
        return { skipped: false, healthy: false, alerted: false, alertReason: 'sendAlert threw' };
    }
}

/** Test-only: reset the module-level de-dup flag between test cases. */
export function __resetAlertedFlagForTests(): void {
    alreadyAlertedThisProcess = false;
}
