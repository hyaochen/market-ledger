/**
 * cash 站介面用的純函式（T-ML-034 介面重設計）。
 *
 * 為什麼獨立成檔：
 * - 導覽 active 判斷、差額狀態、日期/星期、快速區間這些邏輯原本會散在各個 client 元件裡，
 *   沒辦法單元測試；抽成純函式後可以用 node:test 驗（scripts/run-tests.ts 有註冊）。
 * - 本檔同時被 server component 與 client component 引用，
 *   絕不 import React / DOM / Node-only 的 module（跟 cash-constants.ts 同一條規矩）。
 * - 這裡只放「顯示用」的判斷；金額計算與目標值仍以 cash-constants.ts 為唯一來源，不在這裡寫死數字。
 */

import { CASH_BOX_TARGET_TOTAL, RESERVE_TARGET_TOTAL } from "./cash-constants";

// ── 身分 ─────────────────────────────────────────────────────

export type CashShellUser = {
    displayName: string;
    username: string;
    isAdmin: boolean;
    /** 目前登入者的攤位名稱；沒有指派且找不到預設攤位時為 null */
    locationName: string | null;
};

/** 介面上的身分名稱。介面不得出現英文 admin。 */
export function roleLabel(isAdmin: boolean): string {
    return isAdmin ? "管理者" : "清點員";
}

/**
 * 標頭第二行：「姓名 · 身分」。
 * 員工帳號的姓名常常就是預設的「清點員」，兩者相同時只顯示一次，避免出現「清點員 · 清點員」。
 */
export function identityLine(displayName: string, isAdmin: boolean): string {
    const role = roleLabel(isAdmin);
    return displayName === role ? role : `${displayName} · ${role}`;
}

// ── 導覽 ─────────────────────────────────────────────────────

export type CashNavKey = "entry" | "history" | "stats" | "admin" | "account";

export type CashNavItem = {
    key: CashNavKey;
    label: string;
    href: string;
    adminOnly: boolean;
};

export const CASH_NAV_ITEMS: readonly CashNavItem[] = [
    { key: "entry", label: "新增清點", href: "/cash", adminOnly: false },
    { key: "history", label: "歷史", href: "/cash/history", adminOnly: false },
    { key: "stats", label: "分析", href: "/cash/stats", adminOnly: true },
    { key: "admin", label: "管理", href: "/cash/admin", adminOnly: true },
    { key: "account", label: "帳號", href: "/cash/account", adminOnly: false },
];

/** 員工 3 個項目、管理者 5 個。 */
export function navItemsFor(isAdmin: boolean): CashNavItem[] {
    return CASH_NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
}

/**
 * 拿掉 /cash 前綴再比對。
 * cash.* 子網域的 middleware 會把 /history rewrite 成 /cash/history，
 * 瀏覽器網址列可能是 /history 也可能是 /cash/history，兩種都要能判斷目前在哪一頁。
 */
export function normalizeCashPath(pathname: string): string {
    const noQuery = pathname.split("?")[0].split("#")[0];
    const stripped = noQuery.replace(/^\/cash(?=\/|$)/, "");
    const trimmed = stripped.replace(/\/+$/, "");
    return trimmed === "" ? "/" : trimmed;
}

function underPath(path: string, base: string): boolean {
    return path === base || path.startsWith(base + "/");
}

/** 目前網址對應哪個主導覽項目；登入頁等不在導覽內的頁面回 null。 */
export function activeNavKey(pathname: string): CashNavKey | null {
    const p = normalizeCashPath(pathname);
    if (p === "/") return "entry";
    if (underPath(p, "/history")) return "history";
    if (underPath(p, "/stats")) return "stats";
    if (underPath(p, "/admin")) return "admin";
    if (underPath(p, "/account")) return "account";
    return null;
}

export type AdminSubKey = "stats" | "alerts" | "checklist";

export const ADMIN_SUB_ITEMS: readonly { key: AdminSubKey; label: string; href: string }[] = [
    { key: "stats", label: "分析", href: "/cash/stats" },
    { key: "alerts", label: "異常", href: "/cash/admin/alerts" },
    { key: "checklist", label: "動作清單", href: "/cash/admin/checklist" },
];

/** 管理區頁內分段選單的 active 項目。 */
export function activeAdminSubKey(pathname: string): AdminSubKey | null {
    const p = normalizeCashPath(pathname);
    if (underPath(p, "/stats")) return "stats";
    if (underPath(p, "/admin/alerts")) return "alerts";
    if (underPath(p, "/admin/checklist")) return "checklist";
    return null;
}

// ── 數字 / 差額 ──────────────────────────────────────────────

/** 固定用 en-US 做千分位，避免 server（容器預設語系）與 client（手機語系）輸出不同造成 hydration 差異。 */
export function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString("en-US");
}

export function formatNtd(n: number): string {
    return `NT$ ${formatNumber(n)}`;
}

export type DiffStatusKind = "empty" | "balanced" | "over" | "under";

export type DiffStatus = {
    kind: DiffStatusKind;
    /** 實際 - 目標；尚未填寫時為 null */
    diff: number | null;
    /** 短標籤：尚未填寫 / 已平 / 差 +50 / 差 -100 */
    label: string;
    /** 白話補充：比目標多 50 元 / 比目標少 100 元 */
    detail: string;
};

/**
 * 差額狀態（表單區塊標頭、歷史詳情共用）。
 * 預設與原本表單邏輯一致：合計為 0 視為「還沒填」，不顯示差額；有填才跟目標比。
 * 已存檔的紀錄（歷史詳情）傳 zeroIsEmpty=false：0 是真的存下來的數字，要照實跟目標比。
 */
export function diffStatus(total: number, target: number, zeroIsEmpty = true): DiffStatus {
    if (!Number.isFinite(total) || (zeroIsEmpty && total === 0)) {
        return { kind: "empty", diff: null, label: "尚未填寫", detail: "還沒有填寫張數" };
    }
    const diff = total - target;
    if (diff === 0) {
        return { kind: "balanced", diff: 0, label: "已平", detail: "和目標金額一致" };
    }
    if (diff > 0) {
        return { kind: "over", diff, label: `差 +${formatNumber(diff)}`, detail: `比目標多 ${formatNumber(diff)} 元` };
    }
    return { kind: "under", diff, label: `差 -${formatNumber(-diff)}`, detail: `比目標少 ${formatNumber(-diff)} 元` };
}

export type CashCountFlag = {
    kind: "cashBox" | "reserve";
    diff: number;
    label: string;
};

/**
 * 歷史列表的狀態徽章：已存檔的合計 vs 目標。
 * 沒有任何旗標 = 「正常」。判斷方式與原本歷史頁、異常頁一致（直接比對是否等於目標）。
 */
export function countFlags(cashBoxTotal: number, reserveTotal: number): CashCountFlag[] {
    const flags: CashCountFlag[] = [];
    const cashBoxDiff = cashBoxTotal - CASH_BOX_TARGET_TOTAL;
    if (cashBoxDiff !== 0) {
        flags.push({ kind: "cashBox", diff: cashBoxDiff, label: `錢盒差額 ${signed(cashBoxDiff)}` });
    }
    const reserveDiff = reserveTotal - RESERVE_TARGET_TOTAL;
    if (reserveDiff !== 0) {
        flags.push({ kind: "reserve", diff: reserveDiff, label: `備用金差額 ${signed(reserveDiff)}` });
    }
    return flags;
}

function signed(n: number): string {
    return `${n > 0 ? "+" : "-"}${formatNumber(Math.abs(n))}`;
}

// ── 日期 ─────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

function parseIsoParts(iso: string): { y: number; m: number; d: number } | null {
    const m = ISO_DATE.exec(iso);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    // 驗證沒有被 Date 進位（例如 2026-02-31）
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y, m: mo, d };
}

/** 與 server 的 todayLocalIsoDate 同一套規則：用「本機時區」的年月日（容器預設為 UTC，與 submitCashCount 的 parseLocalDate 一致）。 */
export function todayLocalIsoDate(now: Date = new Date()): string {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** YYYY-MM-DD 對應的星期（日～六）；格式不合法回 null。純用 UTC 算，不受伺服器時區影響。 */
export function weekdayChar(iso: string): string | null {
    const p = parseIsoParts(iso);
    if (!p) return null;
    return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
}

/** 2026-10-05 -> 2026年10月5日（日）；不合法的輸入原樣回傳。 */
export function formatDateWithWeekday(iso: string): string {
    const p = parseIsoParts(iso);
    const wd = weekdayChar(iso);
    if (!p || !wd) return iso;
    return `${p.y}年${p.m}月${p.d}日（${wd}）`;
}

/** 2026-10-05 -> 10月5日（日） */
export function formatMonthDayWeekday(iso: string): string {
    const p = parseIsoParts(iso);
    const wd = weekdayChar(iso);
    if (!p || !wd) return iso;
    return `${p.m}月${p.d}日（${wd}）`;
}

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 台北時間（UTC+8，無日光節約）的 HH:mm。不依賴 ICU 與伺服器時區。 */
export function formatTaipeiHHmm(d: Date): string {
    const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
    return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 台北時間的 YYYY-MM-DD HH:mm */
export function formatTaipeiDateTime(d: Date): string {
    const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

// ── 歷史：快速區間 ───────────────────────────────────────────

export type DateRange = { from: string; to: string };

/** YYYY-MM-DD 加減天數（純日期運算，用 UTC 避開時區與日光節約）。格式不合法原樣回傳。 */
export function addDaysIso(iso: string, delta: number): string {
    const p = parseIsoParts(iso);
    if (!p) return iso;
    const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + delta * 24 * 60 * 60 * 1000);
    return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export type QuickRanges = { today: DateRange; last7: DateRange; thisMonth: DateRange };

/** 今天 / 近 7 天（含今天共 7 天）/ 本月（1 號到今天）。 */
export function quickRanges(todayIso: string): QuickRanges {
    const p = parseIsoParts(todayIso);
    if (!p) {
        const same = { from: todayIso, to: todayIso };
        return { today: same, last7: same, thisMonth: same };
    }
    return {
        today: { from: todayIso, to: todayIso },
        last7: { from: addDaysIso(todayIso, -6), to: todayIso },
        thisMonth: { from: `${p.y}-${pad2(p.m)}-01`, to: todayIso },
    };
}

export function isSameRange(from: string | undefined, to: string | undefined, range: DateRange): boolean {
    return (from ?? "") === range.from && (to ?? "") === range.to;
}

// ── 攤位篩選（管理者）────────────────────────────────────────

/** URL 的 loc 參數必須是該租戶現有攤位，否則視為「全部」，避免帶著失效的 id 看到一頁空白。 */
export function resolveLocationFilter(raw: string | undefined | null, locations: readonly { id: string }[]): string | undefined {
    if (!raw) return undefined;
    return locations.some((l) => l.id === raw) ? raw : undefined;
}

/**
 * 在現有網址參數上覆寫幾個值，產生新的連結（切換攤位時要保留 from / to，反之亦然）。
 * overrides 的值是 undefined 或空字串 = 移除那個參數；沒有任何參數時回傳純路徑。
 */
export function hrefWithParams(
    basePath: string,
    params: Record<string, string | undefined>,
    overrides: Record<string, string | undefined>,
): string {
    const merged: Record<string, string | undefined> = { ...params, ...overrides };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
        if (v) usp.set(k, v);
    }
    const qs = usp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
}

// ── 表單輸入清洗 ─────────────────────────────────────────────

/** 張數：只留數字，並去掉前導 0（"05" -> "5"）。伺服器端要求非負整數。 */
export function sanitizeCount(raw: string): string {
    return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** 金額：只留數字與一個小數點。與原本 type=number 輸入框的可輸入範圍等價（伺服器端接受非負數）。 */
export function sanitizeAmount(raw: string): string {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const firstDot = cleaned.indexOf(".");
    const normalized = firstDot === -1
        ? cleaned
        : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
    return normalized.replace(/^0+(?=\d)/, "");
}

/** +/- 步進鈕：不會減到負數；空白再按減號維持空白。 */
export function stepCount(current: string, delta: 1 | -1): string {
    const n = Number(current) || 0;
    if (delta === -1 && current === "") return "";
    return String(Math.max(0, n + delta));
}

// ── 備註（歷史列表與詳情共用）────────────────────────────────

/** 備註沒填時顯示的字。 */
export const NOTE_EMPTY_TEXT = "無";

export type NoteDisplay = {
    /** 要顯示的文字：有內容時是去掉前後空白的原文（內部的換行與空白保留），沒填時固定是「無」 */
    text: string;
    /** true = 沒填。畫面用次要文字色顯示「無」，但對比仍要夠，不能淡到看不清楚 */
    isEmpty: boolean;
};

/**
 * 肉眼看不見、但不屬於空白的字元：軟連字號、零寬空白 / 連字 / 非連字、左右方向標記、字詞連接符。
 * 從別的 App 複製文字貼進備註時常被夾帶；只有這些字元的備註在畫面上就是一格看不見的空白。
 * 用碼位列出（不直接寫在原始碼裡），因為這些字元在編輯器裡看不到，也容易被工具吃掉。
 */
const INVISIBLE_CODE_POINTS: ReadonlySet<number> = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060]);

function isBlankUnit(ch: string): boolean {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true; // 控制字元（含 tab 與換行）
    if (INVISIBLE_CODE_POINTS.has(code)) return true;
    // 其餘空白（半形、全形 U+3000、不換行空白、BOM…）交給 trim：與 String.prototype.trim 的定義一致
    return ch.trim() === "";
}

/**
 * 歷史頁的備註顯示規則：備註一律要看得到。
 * 有填就顯示內容（去掉前後空白，內部換行保留）；沒填（null、空字串、只有空白或看不見的字元）顯示「無」。
 * 不在這裡截斷：列表畫面用 CSS 截成一行，詳情畫面完整顯示。
 */
export function noteDisplay(note: string | null | undefined): NoteDisplay {
    if (typeof note !== "string") return { text: NOTE_EMPTY_TEXT, isEmpty: true };
    for (let i = 0; i < note.length; i++) {
        if (!isBlankUnit(note[i])) return { text: note.trim(), isEmpty: false };
    }
    return { text: NOTE_EMPTY_TEXT, isEmpty: true };
}
