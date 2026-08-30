// 分析 #7：異常偵測 — 6 類，驗收標準取自主控 2026-08-04 / 2026-08-07 稽核的真實髒資料案例
// （vault/projects/market-ledger/reports/2026-07_expense-audit.md）。
//
// 每個偵測器都獨立 export，方便個別測試；detectAllAnomalies() 是彙總入口給 API 用。
//
// 🔴 案例 1（7/31 屏東營業額覆蓋成 50,000）目前資料庫已經被 owner 修正回 9,595
// （見 status.md 2026-08-04 段），所以「跑真實 DB 現在查不到這筆」是正確、預期的結果
// —— 不是偵測器失效。測試對這一類改用「真實分布 + 情境重建」：從真實 DB 讀當時同攤位
// 其他日期的營收分布（唯讀），再用讀到的真實數字重建那筆已被修正的異常值，驗證演算法
// 本身抓得到，而不是竄改資料庫來製造測資。

import prisma from '@/lib/prisma';
import { inferStallFromNote, type StallCode } from './stallInference';
import { isoDateKeyUTC, resolveRange, getWeekdayUTC, type DateRange } from './dateRange';
import { normalizeToKgPrice } from './priceNormalize';
import { median, robustZScore } from './stats';
import { expectedCleaningFee, expectedWashFee, getFixedExpenseDictValues } from './fixedExpenseRules';

const MIN_VALID_YEAR = 2020;
const DEFAULT_Z_THRESHOLD = 3.5; // Iglewicz & Hoaglin 建議值

// ── 案例 1：金額離群（同攤位營業額） ────────────────────────────────────

export interface AmountOutlier {
    id: string;
    date: string;
    stallLabel: string;
    amount: number;
    medianForGroup: number;
    robustZ: number;
    ratioToMedian: number;
}

/** 純函式版本，供單元測試直接餵資料，不吃 DB（也被 DB 版本內部呼叫） */
export function findAmountOutliers(
    points: { id: string; date: string; groupKey: string; groupLabel: string; amount: number }[],
    zThreshold = DEFAULT_Z_THRESHOLD,
    minSamples = 5
): AmountOutlier[] {
    const byGroup = new Map<string, typeof points>();
    for (const p of points) {
        if (!byGroup.has(p.groupKey)) byGroup.set(p.groupKey, []);
        byGroup.get(p.groupKey)!.push(p);
    }

    const outliers: AmountOutlier[] = [];
    for (const group of byGroup.values()) {
        if (group.length < minSamples) continue;
        const amounts = group.map((g) => g.amount);
        const med = median(amounts);
        for (const p of group) {
            const z = robustZScore(p.amount, amounts);
            if (Math.abs(z) >= zThreshold) {
                outliers.push({
                    id: p.id,
                    date: p.date,
                    stallLabel: p.groupLabel,
                    amount: p.amount,
                    medianForGroup: med,
                    robustZ: z,
                    ratioToMedian: med !== 0 ? p.amount / med : NaN,
                });
            }
        }
    }
    outliers.sort((a, b) => Math.abs(b.robustZ) - Math.abs(a.robustZ));
    return outliers;
}

export async function detectRevenueAmountOutliers(
    tenantId: string,
    range: DateRange,
    opts: { zThreshold?: number; minSamples?: number } = {}
): Promise<AmountOutlier[]> {
    const revenues = await prisma.revenue.findMany({
        where: { tenantId, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
        include: { location: true },
    });
    const points = revenues.map((r) => ({
        id: r.id,
        date: isoDateKeyUTC(r.date),
        groupKey: r.locationId,
        groupLabel: r.location?.name ?? r.locationId,
        amount: r.amount,
    }));
    return findAmountOutliers(points, opts.zThreshold, opts.minSamples);
}

// ── 案例 2：單價離群（同品項進貨） ──────────────────────────────────────

export interface PriceOutlier {
    entryId: string;
    date: string;
    itemName: string;
    vendorName: string | null;
    pricePerKg: number;
    medianPricePerKg: number;
    robustZ: number;
    ratioToMedian: number;
}

export async function detectPurchasePriceOutliers(
    tenantId: string,
    range: DateRange,
    opts: { zThreshold?: number; minSamples?: number } = {}
): Promise<PriceOutlier[]> {
    const zThreshold = opts.zThreshold ?? DEFAULT_Z_THRESHOLD;
    const minSamples = opts.minSamples ?? 3;

    const entries = await prisma.entry.findMany({
        where: { tenantId, type: 'PURCHASE', date: { gte: range.gte, lt: range.lt } },
        include: { item: true, vendor: true },
    });

    const byItem = new Map<string, { itemName: string; rows: { entryId: string; date: string; vendorName: string | null; price: number }[] }>();
    for (const e of entries) {
        const norm = normalizeToKgPrice(e);
        if (norm.pricePerKg == null || !e.itemId) continue;
        if (!byItem.has(e.itemId)) byItem.set(e.itemId, { itemName: e.item?.name ?? e.itemId, rows: [] });
        byItem.get(e.itemId)!.rows.push({
            entryId: e.id,
            date: isoDateKeyUTC(e.date),
            vendorName: e.vendor?.name ?? null,
            price: norm.pricePerKg,
        });
    }

    const outliers: PriceOutlier[] = [];
    for (const { itemName, rows } of byItem.values()) {
        if (rows.length < minSamples) continue;
        const prices = rows.map((r) => r.price);
        const med = median(prices);
        for (const r of rows) {
            const z = robustZScore(r.price, prices);
            if (Math.abs(z) >= zThreshold) {
                outliers.push({
                    entryId: r.entryId,
                    date: r.date,
                    itemName,
                    vendorName: r.vendorName,
                    pricePerKg: r.price,
                    medianPricePerKg: med,
                    robustZ: z,
                    ratioToMedian: med !== 0 ? r.price / med : NaN,
                });
            }
        }
    }
    outliers.sort((a, b) => Math.abs(b.robustZ) - Math.abs(a.robustZ));
    return outliers;
}

// ── 案例 3：日期不合理 ──────────────────────────────────────────────────

export interface DateAnomaly {
    source: 'entry' | 'revenue';
    id: string;
    date: string;
    type: string; // Entry.type 或 'REVENUE'
    amount: number;
    note: string | null;
}

export async function detectDateAnomalies(
    tenantId: string,
    opts: { minYear?: number; maxYearAheadOfNow?: number } = {}
): Promise<DateAnomaly[]> {
    const minYear = opts.minYear ?? MIN_VALID_YEAR;
    const maxYear = new Date().getUTCFullYear() + (opts.maxYearAheadOfNow ?? 1);

    const lowerBound = new Date(Date.UTC(minYear, 0, 1));
    const upperBound = new Date(Date.UTC(maxYear + 1, 0, 1));

    const [entries, revenues] = await Promise.all([
        prisma.entry.findMany({
            where: { tenantId, OR: [{ date: { lt: lowerBound } }, { date: { gte: upperBound } }] },
        }),
        prisma.revenue.findMany({
            where: { tenantId, OR: [{ date: { lt: lowerBound } }, { date: { gte: upperBound } }] },
            include: { location: true },
        }),
    ]);

    const anomalies: DateAnomaly[] = [
        ...entries.map((e) => ({
            source: 'entry' as const,
            id: e.id,
            date: isoDateKeyUTC(e.date),
            type: e.type,
            amount: e.totalPrice,
            note: e.note,
        })),
        ...revenues.map((r) => ({
            source: 'revenue' as const,
            id: r.id,
            date: isoDateKeyUTC(r.date),
            type: 'REVENUE',
            amount: r.amount,
            note: r.note,
        })),
    ];
    anomalies.sort((a, b) => (a.date < b.date ? -1 : 1));
    return anomalies;
}

// ── 案例 4：同人多寫法（備註錯字聚類） ──────────────────────────────────

export interface NameVariantCluster {
    /** Entry.expenseType 原始值 */
    expenseType: string;
    /** Dictionary label（人類可讀），查不到時退回 expenseType 本身 */
    expenseLabel: string;
    variants: { note: string; count: number; totalAmount: number }[];
    suggestedCanonical: string;
}

function shouldCluster(a: string, b: string): boolean {
    if (a === b) return false;
    const minLen = Math.min(a.length, b.length);
    if (minLen < 2) return false; // 單字太容易誤判（例如「小」）
    return a.includes(b) || b.includes(a);
}

/**
 * 純函式版本：對「同一個 expenseType 內」的一組 (note, count, amount) 做 containment
 * clustering，供單元測試與 DB 版本共用。
 *
 * 🔴 踩坑記錄：第一版沒有先按 expenseType 分組就直接對全租戶所有備註做 clustering，
 * 結果「廚房」（洗碗精類支出的備註，8 筆）透過字串包含關係把「阿菊廚房」「莉莉廚房」
 * （薪資類支出備註）都串成同一個 cluster，導致演算法「建議」阿菊和莉莉是同一個人 ——
 * 完全錯誤（唯讀查詢驗證過兩人是不同薪資紀錄）。根因是 containment 具遞移性，只要
 * 有一個短字串同時是兩個不相關長字串的子字串，就會把它們橋接在一起。
 * 修法：呼叫端（detectNameVariants）先把 Entry 依 expenseType 分桶，只在同一種支出
 * 類型內做 clustering —— 不同支出類型的備註本來就不該互相比對（薪資的人名備註跟
 * 清潔費的攤位備註是兩個完全不同的語意空間）。
 */
export function clusterNameVariants(
    rows: { note: string; count: number; totalAmount: number }[]
): Omit<NameVariantCluster, 'expenseType' | 'expenseLabel'>[] {
    const notes = rows.map((r) => r.note);
    // union-find
    const parent = new Map<string, string>(notes.map((n) => [n, n]));
    function find(x: string): string {
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root)!;
        return root;
    }
    function union(a: string, b: string) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }
    for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
            if (shouldCluster(notes[i], notes[j])) union(notes[i], notes[j]);
        }
    }

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
        const root = find(row.note);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(row);
    }

    const clusters: Omit<NameVariantCluster, 'expenseType' | 'expenseLabel'>[] = [];
    for (const variants of groups.values()) {
        if (variants.length < 2) continue;
        const sorted = [...variants].sort((a, b) => b.count - a.count);
        clusters.push({
            variants: sorted,
            suggestedCanonical: sorted[0].note, // 出現次數最多的寫法最可能是正確拼法
        });
    }
    return clusters;
}

export async function detectNameVariants(
    tenantId: string,
    range: DateRange,
    opts: { expenseType?: string } = {}
): Promise<NameVariantCluster[]> {
    const [entries, expenseTypeDict] = await Promise.all([
        prisma.entry.findMany({
            where: {
                tenantId,
                type: 'EXPENSE',
                date: { gte: range.gte, lt: range.lt },
                note: { not: null },
                ...(opts.expenseType ? { expenseType: opts.expenseType } : {}),
            },
            select: { note: true, totalPrice: true, expenseType: true },
        }),
        prisma.dictionary.findMany({ where: { tenantId, category: 'expense_type' }, select: { value: true, label: true } }),
    ]);
    const labelMap = new Map(expenseTypeDict.map((d) => [d.value, d.label]));

    // 先依 expenseType 分桶，避免不同支出類型的備註互相橋接（見上方註解的踩坑記錄）
    const byType = new Map<string, Map<string, { count: number; totalAmount: number }>>();
    for (const e of entries) {
        const note = e.note!.trim();
        if (!note) continue;
        const typeKey = e.expenseType ?? 'unknown';
        if (!byType.has(typeKey)) byType.set(typeKey, new Map());
        const freq = byType.get(typeKey)!;
        if (!freq.has(note)) freq.set(note, { count: 0, totalAmount: 0 });
        const bucket = freq.get(note)!;
        bucket.count += 1;
        bucket.totalAmount += e.totalPrice;
    }

    const clusters: NameVariantCluster[] = [];
    for (const [expenseType, freq] of byType) {
        const rows = [...freq.entries()].map(([note, v]) => ({ note, count: v.count, totalAmount: v.totalAmount }));
        const typeClusters = clusterNameVariants(rows);
        for (const c of typeClusters) {
            clusters.push({ expenseType, expenseLabel: labelMap.get(expenseType) ?? expenseType, ...c });
        }
    }
    return clusters;
}

// ── 案例 5：攤位備註不在已知清單（命中已知錯字變體） ────────────────────

export interface StallNoteTypo {
    entryId: string;
    date: string;
    expenseType: string | null;
    note: string;
    inferredStall: StallCode;
    matchedAlias: string;
}

export async function detectStallNoteTypos(tenantId: string, range: DateRange): Promise<StallNoteTypo[]> {
    const entries = await prisma.entry.findMany({
        where: { tenantId, type: 'EXPENSE', date: { gte: range.gte, lt: range.lt }, note: { not: null } },
        select: { id: true, date: true, expenseType: true, note: true },
    });

    const hits: StallNoteTypo[] = [];
    for (const e of entries) {
        const inference = inferStallFromNote(e.note);
        if (inference.stall !== 'unknown' && inference.isKnownTypo) {
            hits.push({
                entryId: e.id,
                date: isoDateKeyUTC(e.date),
                expenseType: e.expenseType,
                note: e.note!,
                inferredStall: inference.stall,
                matchedAlias: inference.matchedAlias!,
            });
        }
    }
    hits.sort((a, b) => (a.date < b.date ? -1 : 1));
    return hits;
}

// ── 案例 6：固定支出缺漏（清潔費/洗攤 依星期規則） ──────────────────────

export interface MissingFixedExpense {
    date: string;
    stall: StallCode;
    stallLabel: string;
    expenseLabel: '清潔費' | '洗攤';
    expectedAmount: number;
    actualAmount: number | null; // null = 完全沒記；有值代表記了但金額不符規則
    status: 'missing' | 'amount_mismatch';
}

// expectedCleaningFee() / expectedWashFee() 規則移到 fixedExpenseRules.ts（T-ML-027
// 需要在自動帶入/補登腳本重用同一套規則，避免分叉），這裡改為 import。

export async function detectMissingFixedExpenses(tenantId: string, range: DateRange): Promise<MissingFixedExpense[]> {
    const [revenues, dictValues] = await Promise.all([
        prisma.revenue.findMany({
            where: { tenantId, date: { gte: range.gte, lt: range.lt }, isDayOff: false, amount: { gt: 0 } },
            include: { location: true },
        }),
        getFixedExpenseDictValues(tenantId),
    ]);

    if (!dictValues) return []; // 該租戶沒設這兩個支出類型，無法比對（例如 demo 租戶）
    const { cleaningValue, washValue } = dictValues;

    const feeEntries = await prisma.entry.findMany({
        where: {
            tenantId,
            type: 'EXPENSE',
            date: { gte: range.gte, lt: range.lt },
            expenseType: { in: [cleaningValue, washValue] },
        },
        select: { date: true, expenseType: true, note: true, totalPrice: true },
    });

    // key: `${dateKey}|${stall}|${expenseType}` → 該筆金額（若同天同攤位同類型多筆，取總和）
    const actualMap = new Map<string, number>();
    for (const fe of feeEntries) {
        const inference = inferStallFromNote(fe.note);
        if (inference.stall === 'unknown') continue; // 連攤位都判斷不出來，不硬猜歸屬
        const key = `${isoDateKeyUTC(fe.date)}|${inference.stall}|${fe.expenseType}`;
        actualMap.set(key, (actualMap.get(key) ?? 0) + fe.totalPrice);
    }

    // 從有營業額的 (date, stall) 組合出「該有固定支出」的清單
    const businessDays = new Map<string, { date: Date; stall: StallCode }>();
    for (const r of revenues) {
        const stall = r.location?.name === '屏東攤位' ? 'pingtung' : r.location?.name === '潮州攤位' ? 'chaozhou' : null;
        if (!stall) continue;
        businessDays.set(`${isoDateKeyUTC(r.date)}|${stall}`, { date: r.date, stall });
    }

    const missing: MissingFixedExpense[] = [];
    for (const { date, stall } of businessDays.values()) {
        const dateKey = isoDateKeyUTC(date);
        const weekday = getWeekdayUTC(date);
        const stallLabel = stall === 'pingtung' ? '屏東' : '潮州';

        const cleaningExpected = expectedCleaningFee(stall, weekday);
        const cleaningActual = actualMap.get(`${dateKey}|${stall}|${cleaningValue}`) ?? null;
        if (cleaningActual == null) {
            missing.push({ date: dateKey, stall, stallLabel, expenseLabel: '清潔費', expectedAmount: cleaningExpected, actualAmount: null, status: 'missing' });
        } else if (cleaningActual !== cleaningExpected) {
            missing.push({ date: dateKey, stall, stallLabel, expenseLabel: '清潔費', expectedAmount: cleaningExpected, actualAmount: cleaningActual, status: 'amount_mismatch' });
        }

        const washExpected = expectedWashFee(stall);
        const washActual = actualMap.get(`${dateKey}|${stall}|${washValue}`) ?? null;
        if (washActual == null) {
            missing.push({ date: dateKey, stall, stallLabel, expenseLabel: '洗攤', expectedAmount: washExpected, actualAmount: null, status: 'missing' });
        } else if (washActual !== washExpected) {
            missing.push({ date: dateKey, stall, stallLabel, expenseLabel: '洗攤', expectedAmount: washExpected, actualAmount: washActual, status: 'amount_mismatch' });
        }
    }

    missing.sort((a, b) => (a.date < b.date ? -1 : 1));
    return missing;
}

// ── 彙總入口 ─────────────────────────────────────────────────────────────

export interface AllAnomaliesResult {
    range: { from: string; to: string };
    amountOutliers: AmountOutlier[];
    priceOutliers: PriceOutlier[];
    dateAnomalies: DateAnomaly[];
    nameVariants: NameVariantCluster[];
    stallNoteTypos: StallNoteTypo[];
    missingFixedExpenses: MissingFixedExpense[];
    summary: Record<string, number>;
}

export async function detectAllAnomalies(
    tenantId: string,
    from?: string | null,
    to?: string | null
): Promise<AllAnomaliesResult> {
    const range = resolveRange(from, to, 90);

    const [amountOutliers, priceOutliers, dateAnomalies, nameVariants, stallNoteTypos, missingFixedExpenses] = await Promise.all([
        detectRevenueAmountOutliers(tenantId, range),
        detectPurchasePriceOutliers(tenantId, range),
        detectDateAnomalies(tenantId), // 日期異常是絕對值判斷，不受 range 篩選（範圍本身可能就是錯的年份）
        detectNameVariants(tenantId, range),
        detectStallNoteTypos(tenantId, range),
        detectMissingFixedExpenses(tenantId, range),
    ]);

    return {
        range: { from: range.fromKey, to: range.toKey },
        amountOutliers,
        priceOutliers,
        dateAnomalies,
        nameVariants,
        stallNoteTypos,
        missingFixedExpenses,
        summary: {
            amountOutliers: amountOutliers.length,
            priceOutliers: priceOutliers.length,
            dateAnomalies: dateAnomalies.length,
            nameVariantClusters: nameVariants.length,
            stallNoteTypos: stallNoteTypos.length,
            missingFixedExpenses: missingFixedExpenses.length,
        },
    };
}
