// 分析 #5：攤位損益對比 — 屏東 vs 潮州。
//
// 🔴 誠實面對限制（owner spec 明講不准硬湊）：
// - Revenue 有正式 locationId，營業額可以精準分攤位。
// - Entry（進貨+支出）沒有 locationId，只能靠 note 字串猜（stallInference.ts）。
//   實測：July 158 筆進貨裡只有 3 筆有備註，且沒有一筆備註內容對得到「中山/潮州」——
//   進貨事實上 100% 無法分攤位。支出（清潔費/洗攤/薪資/水電費等）備註習慣好很多，
//   大部分寫得出攤位。
// - 因此本模組把 Entry 拆兩桶：能靠備註可信推斷（inferStallFromNote confidence>=閾值）
//   的算「可歸屬成本」，推不出來的全部算「共同成本」（shared），不強行對半分攤或
//   用其他方式估算 —— 那樣只會做出一個看起來精準但其實是編出來的假損益。

import prisma from '@/lib/prisma';
import { inferStallFromNote, STALLS, type StallCode } from './stallInference';
import { resolveRange } from './dateRange';

export interface StallProfitParams {
    tenantId: string;
    from?: string | null;
    to?: string | null;
    /** stallInference 信心度門檻，預設 0.75（含已知錯字變體也算可歸屬） */
    minConfidence?: number;
}

export interface StallProfitBucket {
    stall: StallCode;
    label: string;
    revenue: number;
    revenueDays: number;
    attributedExpense: number;
    attributedPurchase: number;
    /** revenue - attributedExpense - attributedPurchase（只算得出來的部分，非全成本毛利） */
    netAttributed: number;
}

export interface StallProfitResult {
    range: { from: string; to: string };
    byStall: StallProfitBucket[];
    shared: {
        unattributedExpense: number;
        unattributedExpenseCount: number;
        unattributedPurchase: number;
        unattributedPurchaseCount: number;
        totalShared: number;
    };
    totals: {
        revenue: number;
        expense: number;
        purchase: number;
        combinedProfit: number; // revenue - expense - purchase（不分攤位的整體損益，可信）
    };
    coverage: {
        expenseAttributionRate: number; // 0~1，能歸屬到攤位的支出金額占比
        purchaseAttributionRate: number; // 0~1，同上（進貨）
    };
    caveat: string;
}

export async function getStallProfitComparison(params: StallProfitParams): Promise<StallProfitResult> {
    const { tenantId } = params;
    const minConfidence = params.minConfidence ?? 0.75;
    const range = resolveRange(params.from, params.to, 30);

    const [revenues, entries] = await Promise.all([
        prisma.revenue.findMany({
            where: { tenantId, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
            include: { location: true },
        }),
        prisma.entry.findMany({
            where: { tenantId, date: { gte: range.gte, lt: range.lt } },
        }),
    ]);

    const revenueByStall = new Map<StallCode, { amount: number; days: number }>();
    for (const stall of STALLS) revenueByStall.set(stall.code, { amount: 0, days: 0 });

    for (const r of revenues) {
        const stall = STALLS.find((s) => s.locationName === r.location?.name);
        if (!stall) continue; // demo tenant 或未知地點，理論上不會發生（tenantId 已隔離）
        const bucket = revenueByStall.get(stall.code)!;
        bucket.amount += r.amount;
        bucket.days += 1;
    }

    const expenseByStall = new Map<StallCode, number>();
    const purchaseByStall = new Map<StallCode, number>();
    for (const stall of STALLS) {
        expenseByStall.set(stall.code, 0);
        purchaseByStall.set(stall.code, 0);
    }

    let unattributedExpense = 0;
    let unattributedExpenseCount = 0;
    let unattributedPurchase = 0;
    let unattributedPurchaseCount = 0;
    let totalExpense = 0;
    let totalPurchase = 0;

    for (const e of entries) {
        if (e.type === 'EXPENSE') {
            totalExpense += e.totalPrice;
            const inference = inferStallFromNote(e.note);
            if (inference.stall !== 'unknown' && inference.confidence >= minConfidence) {
                expenseByStall.set(inference.stall, expenseByStall.get(inference.stall)! + e.totalPrice);
            } else {
                unattributedExpense += e.totalPrice;
                unattributedExpenseCount += 1;
            }
        } else if (e.type === 'PURCHASE') {
            totalPurchase += e.totalPrice;
            const inference = inferStallFromNote(e.note);
            if (inference.stall !== 'unknown' && inference.confidence >= minConfidence) {
                purchaseByStall.set(inference.stall, purchaseByStall.get(inference.stall)! + e.totalPrice);
            } else {
                unattributedPurchase += e.totalPrice;
                unattributedPurchaseCount += 1;
            }
        }
    }

    const byStall: StallProfitBucket[] = STALLS.map((stall) => {
        const rev = revenueByStall.get(stall.code)!;
        const exp = expenseByStall.get(stall.code)!;
        const pur = purchaseByStall.get(stall.code)!;
        return {
            stall: stall.code,
            label: stall.label,
            revenue: rev.amount,
            revenueDays: rev.days,
            attributedExpense: exp,
            attributedPurchase: pur,
            netAttributed: rev.amount - exp - pur,
        };
    });

    const totalRevenue = [...revenueByStall.values()].reduce((s, v) => s + v.amount, 0);

    return {
        range: { from: range.fromKey, to: range.toKey },
        byStall,
        shared: {
            unattributedExpense,
            unattributedExpenseCount,
            unattributedPurchase,
            unattributedPurchaseCount,
            totalShared: unattributedExpense + unattributedPurchase,
        },
        totals: {
            revenue: totalRevenue,
            expense: totalExpense,
            purchase: totalPurchase,
            combinedProfit: totalRevenue - totalExpense - totalPurchase,
        },
        coverage: {
            expenseAttributionRate: totalExpense > 0 ? (totalExpense - unattributedExpense) / totalExpense : 0,
            purchaseAttributionRate: totalPurchase > 0 ? (totalPurchase - unattributedPurchase) / totalPurchase : 0,
        },
        caveat:
            '進貨（PURCHASE）幾乎沒有攤位備註，無法可靠分攤到單一攤位，已全數列入 shared 共同成本；' +
            '「netAttributed」只反映找得到攤位依據的支出，不是該攤位的完整損益。要看全店整體損益請用 totals.combinedProfit。',
    };
}
