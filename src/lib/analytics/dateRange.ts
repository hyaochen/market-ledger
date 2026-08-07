// 共用日期範圍工具 — 分析模組專用
//
// 🔴 重要背景（T-ML-025 批 1 踩坑點，務必讀完再改這支檔案）：
// Entry.date / Revenue.date 存進 SQLite 的值是「該筆記錄所屬營業日的 UTC 午夜」epoch ms。
// 這不是巧合 —— 寫入路徑（web server actions、bot）在 Docker 容器內執行，容器沒有設定
// TZ 環境變數，Node 預設走 UTC，所以 `new Date(year, month-1, day)`（local 建構子）
// 在容器裡剛好等於 UTC 午夜。已用 `prisma.$queryRawUnsafe('SELECT date FROM Entry ...')`
// 實測驗證：2026-07-01 的記錄存的是 1751328000000（= 2026-07-01T00:00:00.000Z）。
//
// 這支分析模組不是跑在 Docker 容器裡（單元測試用 tsx 直接在 host 跑，host TZ 是
// Asia/Taipei UTC+8）。如果沿用 `new Date(y, m-1, d)`（local）去建構查詢邊界，
// host 上會算出 UTC+8 的午夜，比資料庫實際存的 UTC 午夜晚 8 小時 —— 範圍查詢會
// 悄悄地整批日期查詢對不上（off-by-8-hours，非 off-by-one-day，更難發現）。
//
// 結論：本檔全面使用 `Date.UTC(...)` / `getUTCFullYear()` 等 UTC-based API 建構與
// 讀取日期邊界，禁止使用 local Date 建構子或 getFullYear()/getMonth()/getDay()。
// 批 2 / 批 3 接手時如果也要處理日期範圍查詢，請比照本檔模式，不要抄 EntryForm 那套
// local Date（那套是給瀏覽器端 <input type=date> 用的，跟這裡的假設不同）。

export interface DateRange {
    /** 含（inclusive），UTC 午夜 */
    gte: Date;
    /** 不含（exclusive），UTC 午夜，= 最後一天的隔天 */
    lt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 建構 UTC 午夜 Date，例如 utcDate(2026,7,1) → 2026-07-01T00:00:00.000Z */
export function utcDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/** 解析 'YYYY-MM-DD' 字串為 UTC 午夜 Date；格式不對回傳 null */
export function parseISODateUTC(value?: string | null): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = utcDate(year, month, day);
    // 驗證 rollover（例如 2026-02-30 不合法）
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }
    return date;
}

/** 'YYYY-MM-DD'（UTC 基準）*/
export function isoDateKeyUTC(date: Date): string {
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 'YYYY-MM'（UTC 基準）*/
export function monthKeyUTC(date: Date): string {
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    return `${y}-${m}`;
}

/** 0=日 1=一 2=二 3=三 4=四 5=五 6=六（UTC 基準，對齊儲存時的 UTC 午夜=業務當地日期）*/
export function getWeekdayUTC(date: Date): number {
    return date.getUTCDay();
}

export function addDaysUTC(date: Date, days: number): Date {
    return new Date(date.getTime() + days * DAY_MS);
}

export function addMonthsUTC(date: Date, months: number): Date {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    // 用 UTC 年月日重建，避免月底溢位（例如 1/31 加一個月不該變 3/3）
    const targetMonthIndex = m + months;
    const targetYear = y + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(d, daysInTargetMonth)));
}

/** 單日查詢邊界：[該日 UTC 午夜, 隔日 UTC 午夜) */
export function dayRangeUTC(date: Date): DateRange {
    const gte = utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    return { gte, lt: addDaysUTC(gte, 1) };
}

/** 某年某月查詢邊界（month 為 1-12）：[該月 1 日, 隔月 1 日) */
export function monthRangeUTC(year: number, month: number): DateRange {
    const gte = utcDate(year, month, 1);
    const lt = addMonthsUTC(gte, 1);
    return { gte, lt };
}

export interface ResolvedRange extends DateRange {
    fromKey: string;
    toKey: string;
}

/**
 * 解析 API query string 的 from/to（'YYYY-MM-DD'，皆為含），
 * 缺省時回溯 defaultDays 天（含今天）。
 * to 若提供，會自動轉換成 exclusive 上界（隔天 UTC 午夜）方便直接餵給 Prisma `lt`。
 */
export function resolveRange(
    fromParam?: string | null,
    toParam?: string | null,
    defaultDays = 30
): ResolvedRange {
    const now = new Date();
    const todayUTC = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());

    const to = parseISODateUTC(toParam) ?? todayUTC;
    const from = parseISODateUTC(fromParam) ?? addDaysUTC(to, -(defaultDays - 1));

    const gte = from <= to ? from : to;
    const inclusiveEnd = from <= to ? to : from;
    const lt = addDaysUTC(inclusiveEnd, 1);

    return { gte, lt, fromKey: isoDateKeyUTC(gte), toKey: isoDateKeyUTC(inclusiveEnd) };
}
