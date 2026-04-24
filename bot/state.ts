// Bot 狀態機：in-memory Map 為主（同步讀寫），write-through 到 SystemConfig 以撐過 bot 重啟
//
// 啟動時呼叫 preloadStates() 從 DB 拉回所有對話狀態，之後讀寫維持同步、寫入非同步
// 持久化到 DB（fire-and-forget）。同一 chatId 的多次 setState 用最後寫入勝出策略。

import prisma from '../src/lib/prisma';
import type { ChatState, ParsedEntry, SessionData, NewItemPending } from './types';

const STATE_KEY_PREFIX = 'tg_state_';
const states = new Map<number, ChatState>();

function getDefault(): ChatState {
    return {
        phase: 'idle',
        pendingEntries: [],
        confirmedEntries: [],
        uncertainQueue: [],
        currentUncertain: null,
        session: null,
        newItemPending: null,
        muteMode: false,
    };
}

function persistAsync(chatId: number, state: ChatState): void {
    // idle 且沒有 session → 清掉 DB 中的條目，避免累積
    const isEmpty =
        state.phase === 'idle' &&
        state.session == null &&
        state.pendingEntries.length === 0 &&
        state.confirmedEntries.length === 0 &&
        state.uncertainQueue.length === 0 &&
        state.newItemPending == null &&
        !state.muteMode;

    const key = `${STATE_KEY_PREFIX}${chatId}`;

    (async () => {
        try {
            if (isEmpty) {
                await prisma.systemConfig.deleteMany({ where: { key, tenantId: null } });
                return;
            }
            const value = JSON.stringify(state);
            const existing = await prisma.systemConfig.findFirst({ where: { key, tenantId: null } });
            if (existing) {
                await prisma.systemConfig.update({ where: { id: existing.id }, data: { value } });
            } else {
                await prisma.systemConfig.create({ data: { key, value, tenantId: null } });
            }
        } catch (err) {
            console.warn('[bot/state] persist failed for chatId=%s: %s', chatId, (err as Error)?.message ?? err);
        }
    })();
}

// bot/index.ts 啟動時呼叫：把所有舊狀態拉回記憶體
export async function preloadStates(): Promise<number> {
    try {
        const rows = await prisma.systemConfig.findMany({
            where: { key: { startsWith: STATE_KEY_PREFIX }, tenantId: null },
        });
        let loaded = 0;
        for (const row of rows) {
            const chatId = Number(row.key.slice(STATE_KEY_PREFIX.length));
            if (!Number.isFinite(chatId)) continue;
            try {
                const parsed = JSON.parse(row.value) as ChatState;
                // 合併預設值，容忍欄位新增
                states.set(chatId, { ...getDefault(), ...parsed });
                loaded++;
            } catch {
                // 壞掉的 state 直接丟掉，不阻擋 bot 啟動
            }
        }
        console.log(`[bot/state] preloaded ${loaded} chat state(s) from DB`);
        return loaded;
    } catch (err) {
        console.warn('[bot/state] preload failed (non-fatal):', (err as Error)?.message ?? err);
        return 0;
    }
}

export function getState(chatId: number): ChatState {
    if (!states.has(chatId)) {
        states.set(chatId, getDefault());
    }
    return states.get(chatId)!;
}

export function setState(chatId: number, update: Partial<ChatState>): void {
    const current = getState(chatId);
    const next = { ...current, ...update };
    states.set(chatId, next);
    persistAsync(chatId, next);
}

export function setSession(chatId: number, session: SessionData | null): void {
    setState(chatId, { session });
}

export function resetToIdle(chatId: number): void {
    const s = getState(chatId);
    const next = {
        ...getDefault(),
        session: s.session,   // 保留 session
        muteMode: s.muteMode, // 保留靜音設定（不因記錄完成而重置）
    };
    states.set(chatId, next);
    persistAsync(chatId, next);
}

// 開始確認流程：把待確認的分出來
export function startConfirmation(chatId: number, all: ParsedEntry[]): {
    confident: ParsedEntry[];
    uncertain: ParsedEntry[];
} {
    const confident = all.filter(e => e.confident);
    const uncertain = all.filter(e => !e.confident);

    setState(chatId, {
        phase: 'awaiting_confirmation',
        pendingEntries: all,
        confirmedEntries: [...confident],  // 高信心直接放入
        uncertainQueue: uncertain.slice(1),
        currentUncertain: uncertain[0] ?? null,
        newItemPending: null,
    });

    return { confident, uncertain };
}

// 用戶確認當前 uncertain → 接受
// 回傳 { accepted, next }，讓呼叫端判斷是否需要走新增流程
export function acceptCurrent(chatId: number): { accepted: ParsedEntry | null; next: ParsedEntry | null } {
    const s = getState(chatId);
    if (!s.currentUncertain) return { accepted: null, next: null };

    const accepted = s.currentUncertain;
    const nextUncertain = s.uncertainQueue[0] ?? null;

    setState(chatId, {
        confirmedEntries: [...s.confirmedEntries, accepted],
        uncertainQueue: s.uncertainQueue.slice(1),
        currentUncertain: nextUncertain,
        phase: nextUncertain ? 'awaiting_confirmation' : 'idle',
    });

    return { accepted, next: nextUncertain };
}

// 移除最後一筆 confirmed（新增流程需要先移除再重新加入）
export function removeLastConfirmed(chatId: number): ParsedEntry | null {
    const s = getState(chatId);
    if (s.confirmedEntries.length === 0) return null;
    const last = s.confirmedEntries[s.confirmedEntries.length - 1];
    setState(chatId, { confirmedEntries: s.confirmedEntries.slice(0, -1) });
    return last;
}

// 把更新後的 entry 加回 confirmed（新增流程完成後用）
export function addToConfirmed(chatId: number, entry: ParsedEntry): void {
    const s = getState(chatId);
    setState(chatId, { confirmedEntries: [...s.confirmedEntries, entry] });
}

// 進入新增模式（暫停確認流程）
export function enterNewItemFlow(chatId: number, pending: NewItemPending): void {
    setState(chatId, {
        phase: pending.entry.type === 'EXPENSE' ? 'awaiting_new_expense' : 'awaiting_new_purchase',
        newItemPending: pending,
    });
}

// 結束新增模式，恢復到下一個不確定項目或 idle
export function exitNewItemFlow(chatId: number): ParsedEntry | null {
    const s = getState(chatId);
    const next = s.newItemPending?.nextUncertain ?? null;
    setState(chatId, {
        phase: next ? 'awaiting_confirmation' : 'idle',
        newItemPending: null,
        currentUncertain: next,
    });
    return next;
}

// 用戶拒絕當前 uncertain → 跳過
export function rejectCurrent(chatId: number): ParsedEntry | null {
    const s = getState(chatId);
    const next = s.uncertainQueue[0] ?? null;

    setState(chatId, {
        uncertainQueue: s.uncertainQueue.slice(1),
        currentUncertain: next,
        phase: next ? 'awaiting_confirmation' : 'idle',
    });

    return next;
}

export function getAllConfirmed(chatId: number): ParsedEntry[] {
    return getState(chatId).confirmedEntries;
}
