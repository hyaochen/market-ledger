'use server';

import { z } from "zod";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { parseLocalDate } from "@/lib/date";
import { requireCashAuth, requireCashAdmin } from "@/lib/cash-auth";

// ---------- Schema ----------

const denomMapSchema = z.record(z.string(), z.number().int().nonnegative());

const expenseRowSchema = z.object({
    item: z.string().trim().max(120),
    note: z.string().trim().max(200).optional().default(""),
    amount: z.number().nonnegative(),
});

const submitCashCountSchema = z.object({
    date: z.string().min(8), // YYYY-MM-DD
    cashBox: denomMapSchema,
    reserve: denomMapSchema,
    sales: denomMapSchema,
    expenses: z.array(expenseRowSchema),
    checklistDone: z.array(z.object({
        id: z.string(),
        done: z.boolean(),
    })),
    signatureDataUrl: z.string().regex(/^data:image\/(png|jpeg|jpg);base64,/, "簽名格式錯誤"),
    note: z.string().optional().default(""),
});

export type SubmitCashCountInput = z.infer<typeof submitCashCountSchema>;

// ---------- Helpers ----------

function sumDenoms(map: Record<string, number>): number {
    return Object.entries(map).reduce((total, [denom, qty]) => {
        const d = Number(denom);
        const q = Number(qty) || 0;
        return total + (Number.isFinite(d) ? d * q : 0);
    }, 0);
}

function sumExpenses(rows: { amount: number }[]): number {
    return rows.reduce((t, r) => t + (Number(r.amount) || 0), 0);
}

// 過濾空 expense row（item + note + amount 全空就丟掉）
function filterExpenses(rows: z.infer<typeof expenseRowSchema>[]) {
    return rows.filter((r) => r.item.trim() !== "" || (r.note ?? "").trim() !== "" || (r.amount ?? 0) > 0);
}

// ---------- Submit ----------

export async function submitCashCount(input: SubmitCashCountInput) {
    try {
        const user = await requireCashAuth();
        if (!user.locationId) {
            return { success: false, error: "找不到您的攤位設定，請聯絡管理員。" };
        }

        const parsed = submitCashCountSchema.safeParse(input);
        if (!parsed.success) {
            return { success: false, error: parsed.error.issues[0]?.message ?? "資料格式錯誤" };
        }
        const data = parsed.data;

        const date = parseLocalDate(data.date);
        if (!date) {
            return { success: false, error: "日期格式錯誤" };
        }

        const cashBoxTotal = sumDenoms(data.cashBox);
        const reserveTotal = sumDenoms(data.reserve);
        const salesTotal = sumDenoms(data.sales);
        const expensesClean = filterExpenses(data.expenses);
        const expensesTotal = sumExpenses(expensesClean);
        const totalSales = salesTotal + expensesTotal;

        const result = await prisma.$transaction(async (tx) => {
            // 1. 同日同 location 已存在 CashCount？ → 更新；否則新增
            const existingCount = await tx.cashCount.findFirst({
                where: { date, locationId: user.locationId!, tenantId: user.tenantId },
                select: { id: true, revenueId: true },
            });

            // 2. 同日同 location 已存在 Revenue？
            const existingRevenue = await tx.revenue.findFirst({
                where: { date, locationId: user.locationId!, tenantId: user.tenantId },
            });

            // 3. upsert Revenue（用 totalSales 寫入 / 修正）
            let revenue;
            if (existingRevenue) {
                revenue = await tx.revenue.update({
                    where: { id: existingRevenue.id },
                    data: {
                        amount: totalSales,
                        isDayOff: false,
                        note: (existingRevenue.note ? existingRevenue.note + " | " : "") + `cash 清點修正 (${user.username})`,
                    },
                });
            } else {
                revenue = await tx.revenue.create({
                    data: {
                        date,
                        locationId: user.locationId!,
                        tenantId: user.tenantId,
                        amount: totalSales,
                        isDayOff: false,
                        note: `來自 cash 清點 (${user.username})`,
                    },
                });
            }

            // 4. upsert CashCount
            const cashCountData = {
                date,
                tenantId: user.tenantId,
                locationId: user.locationId!,
                attendantId: user.id,
                supervisorName: "洪怜俼",
                cashBoxJson: JSON.stringify(data.cashBox),
                cashBoxTotal,
                reserveJson: JSON.stringify(data.reserve),
                reserveTotal,
                salesJson: JSON.stringify(data.sales),
                salesTotal,
                expensesJson: JSON.stringify(expensesClean),
                expensesTotal,
                totalSales,
                signatureDataUrl: data.signatureDataUrl,
                supervisorSignDataUrl: data.signatureDataUrl, // auto-sync per spec
                handoverTime: new Date(),
                revenueId: revenue.id,
                note: data.note || null,
            };

            let cashCount;
            if (existingCount) {
                cashCount = await tx.cashCount.update({
                    where: { id: existingCount.id },
                    data: cashCountData,
                });
                // 重置 checklist done — 先刪後建（簡單最穩）
                await tx.cashCountChecklistDone.deleteMany({
                    where: { cashCountId: existingCount.id },
                });
            } else {
                cashCount = await tx.cashCount.create({ data: cashCountData });
            }

            // 5. checklist done rows（只插 done=true 的；done=false 不插，前端可推算）
            for (const c of data.checklistDone) {
                await tx.cashCountChecklistDone.create({
                    data: {
                        cashCountId: cashCount.id,
                        checklistItemId: c.id,
                        done: c.done,
                    },
                });
            }

            return { cashCountId: cashCount.id, revenueId: revenue.id };
        });

        revalidatePath("/cash/history");
        revalidatePath("/cash/stats");
        revalidatePath("/revenue");
        revalidatePath("/reports");
        return { success: true, ...result };
    } catch (error) {
        console.error("submitCashCount error:", error);
        return { success: false, error: error instanceof Error ? error.message : "儲存失敗" };
    }
}

// ---------- Queries ----------

export async function listCashCounts(filters?: { from?: string; to?: string; mineOnly?: boolean }) {
    const user = await requireCashAuth();
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (filters?.from) {
        const f = parseLocalDate(filters.from);
        if (f) (where as { date?: Record<string, Date> }).date = { ...(where.date as object), gte: f };
    }
    if (filters?.to) {
        const t = parseLocalDate(filters.to);
        if (t) (where as { date?: Record<string, Date> }).date = { ...(where.date as object), lte: t };
    }
    // 員工只看自己；admin 看全部
    if (filters?.mineOnly || (!user.isAdmin)) {
        where.attendantId = user.id;
    }
    return prisma.cashCount.findMany({
        where,
        orderBy: { date: "desc" },
        include: { location: true, attendant: { select: { username: true, realName: true } } },
        take: 200,
    });
}

export async function getCashCountById(id: string) {
    const user = await requireCashAuth();
    const cc = await prisma.cashCount.findFirst({
        where: { id, tenantId: user.tenantId },
        include: {
            location: true,
            attendant: { select: { username: true, realName: true } },
            checklistDones: { include: { item: true } },
        },
    });
    if (!cc) return null;
    // 員工只能看自己
    if (!user.isAdmin && cc.attendantId !== user.id) return null;
    return cc;
}

export async function listActiveChecklistItems() {
    const user = await requireCashAuth();
    return prisma.checklistItem.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
}

// ---------- Admin: checklist CRUD ----------

export async function adminCreateChecklistItem(name: string, sortOrder = 0) {
    const user = await requireCashAdmin();
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "名稱不可空白" };
    await prisma.checklistItem.create({
        data: { name: trimmed, sortOrder, tenantId: user.tenantId, isActive: true },
    });
    revalidatePath("/cash/admin/checklist");
    return { success: true };
}

export async function adminUpdateChecklistItem(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean }) {
    const user = await requireCashAdmin();
    const existing = await prisma.checklistItem.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return { success: false, error: "找不到清單項目" };

    await prisma.checklistItem.update({
        where: { id },
        data: {
            ...(data.name !== undefined ? { name: data.name.trim() } : {}),
            ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
    });
    revalidatePath("/cash/admin/checklist");
    return { success: true };
}

export async function adminDeleteChecklistItem(id: string) {
    const user = await requireCashAdmin();
    const existing = await prisma.checklistItem.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!existing) return { success: false, error: "找不到清單項目" };
    // 軟刪：保留歷史 cashCount 對該項目的 done 紀錄完整
    await prisma.checklistItem.update({ where: { id }, data: { isActive: false } });
    revalidatePath("/cash/admin/checklist");
    return { success: true };
}

// ---------- Admin: alerts ----------

export type CashAlert = {
    type: "diff" | "checklist" | "missing";
    date: string;
    locationName: string | null;
    detail: string;
    cashCountId?: string;
};

export async function listCashAlerts(): Promise<CashAlert[]> {
    const user = await requireCashAdmin();
    const items = await prisma.cashCount.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { date: "desc" },
        take: 90,
        include: {
            location: { select: { name: true } },
            checklistDones: { include: { item: true } },
        },
    });

    const alerts: CashAlert[] = [];

    for (const cc of items) {
        const dateStr = cc.date.toISOString().slice(0, 10);
        // 差額未平
        if (cc.cashBoxTotal !== 6580) {
            alerts.push({
                type: "diff",
                date: dateStr,
                locationName: cc.location.name,
                detail: `錢盒 ${cc.cashBoxTotal} ≠ 目標 6,580（差 ${cc.cashBoxTotal - 6580}）`,
                cashCountId: cc.id,
            });
        }
        if (cc.reserveTotal !== 7600) {
            alerts.push({
                type: "diff",
                date: dateStr,
                locationName: cc.location.name,
                detail: `備用金 ${cc.reserveTotal} ≠ 目標 7,600（差 ${cc.reserveTotal - 7600}）`,
                cashCountId: cc.id,
            });
        }
        // 動作未全打勾（限 isActive 項目）
        const undone = cc.checklistDones.filter((d) => d.item.isActive && !d.done);
        if (undone.length > 0) {
            alerts.push({
                type: "checklist",
                date: dateStr,
                locationName: cc.location.name,
                detail: `未完成 ${undone.length} 項：${undone.map((u) => u.item.name).join("、")}`,
                cashCountId: cc.id,
            });
        }
    }

    // 缺漏日期偵測（連續日期斷層）
    const dateSet = new Set(items.map((i) => i.date.toISOString().slice(0, 10)));
    if (items.length >= 2) {
        const sortedAsc = [...items].reverse(); // oldest first
        const start = new Date(sortedAsc[0].date);
        const end = new Date(sortedAsc[sortedAsc.length - 1].date);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const k = d.toISOString().slice(0, 10);
            if (!dateSet.has(k)) {
                alerts.push({
                    type: "missing",
                    date: k,
                    locationName: null,
                    detail: "整天無清點紀錄",
                });
            }
        }
    }

    return alerts;
}
