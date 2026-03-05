// In-memory 狀態機（單進程，重啟不影響 DB session）

import type { ChatState, ParsedEntry, SessionData, NewItemPending } from './types';

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
    };
}

export function getState(chatId: number): ChatState {
    if (!states.has(chatId)) {
        states.set(chatId, getDefault());
    }
    return states.get(chatId)!;
}

export function setState(chatId: number, update: Partial<ChatState>): void {
    const current = getState(chatId);
    states.set(chatId, { ...current, ...update });
}

export function setSession(chatId: number, session: SessionData | null): void {
    setState(chatId, { session });
}

export function resetToIdle(chatId: number): void {
    const s = getState(chatId);
    states.set(chatId, {
        ...getDefault(),
        session: s.session,  // 保留 session
    });
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
    const next = s.uncertainQueue[0] ?? null;

    setState(chatId, {
        confirmedEntries: [...s.confirmedEntries, accepted],
        uncertainQueue: s.uncertainQueue.slice(1),
        currentUncertain: next,
        phase: next ? 'awaiting_confirmation' : 'idle',
    });

    return { accepted, next };
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
