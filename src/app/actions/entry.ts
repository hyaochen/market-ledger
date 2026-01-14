'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { convertToKg, parseUnitMeta, type UnitDef, UNITS } from '@/lib/units';
import { parseLocalDate } from '@/lib/date';
import { ensureRole } from '@/lib/auth';

export interface CreateEntryState {
    success?: boolean;
    message?: string;
    errors?: Record<string, string[]>;
}

export async function createEntry(prevState: any, formData: FormData): Promise<CreateEntryState> {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, message: auth.error };
        const user = auth.user;

        const type = formData.get('type') as string;
        const dateInput = formData.get('date') as string | null;
        const date = parseLocalDate(dateInput) ?? new Date();

        // 基本驗證
        if (!type) {
            return { success: false, message: '缺少類型資料' };
        }

        // 準備資料物件
        const data: any = {
            type,
            date,
            status: 'APPROVED', // 預設直接核准，未來可改為 DRAFT
            createdAt: new Date(),
            updatedAt: new Date(),
            userId: user.id,
        };

        if (type === 'PURCHASE') {
            const itemId = formData.get('itemId') as string;
            const vendorId = formData.get('vendorId') as string;
            const weightRaw = formData.get('weight') as string;
            const unit = (formData.get('unit') as string | null) ?? 'kg';
            const priceRaw = formData.get('price') as string;
            const note = (formData.get('note') as string | null)?.trim();
            const weight = Number.parseFloat(weightRaw);
            const price = Number.parseFloat(priceRaw);

            if (!itemId || !Number.isFinite(weight) || !Number.isFinite(price) || weight <= 0 || price < 0) {
                return { success: false, message: '請填寫完整進貨資訊' };
            }

            const unitRow = await prisma.dictionary.findUnique({
                where: { category_value: { category: 'unit', value: unit } },
            });
            const unitMeta = parseUnitMeta(unitRow?.meta);
            const unitDef: UnitDef | undefined = unitRow
                ? {
                    code: unitRow.value,
                    name: unitRow.label,
                    isWeight: unitMeta.isWeight ?? typeof unitMeta.toKg === 'number',
                    toKg: unitMeta.toKg,
                }
                : UNITS.find((item) => item.code === unit);

            // 轉換標準重量 (秤重單位才會換算)
            const standardWeight = unitDef
                ? convertToKg(weight, unitDef.code, [unitDef])
                : null;

            data.itemId = itemId;
            data.vendorId = vendorId === 'none' ? null : vendorId;
            data.inputQuantity = weight;
            data.inputUnit = unit;
            data.standardWeight = standardWeight;
            data.totalPrice = price;
            data.unitPrice = standardWeight ? price / standardWeight : price / weight;
            data.note = note || null;

        } else if (type === 'EXPENSE') {
            const expenseType = formData.get('expenseType') as string;
            const amountRaw = formData.get('amount') as string;
            const amount = Number.parseFloat(amountRaw);
            const note = (formData.get('note') as string | null)?.trim();

            if (!expenseType || !Number.isFinite(amount) || amount < 0) {
                return { success: false, message: '請填寫完整支出資訊' };
            }

            data.expenseType = expenseType;
            data.totalPrice = amount;
            data.note = note || null;
        }

        // 儲存到資料庫
        await prisma.entry.create({
            data: data,
        });

        // 記錄日誌
        await prisma.operationLog.create({
            data: {
                action: 'CREATE',
                module: 'ENTRY',
                userId: user.id,
                details: JSON.stringify({ type, amount: data.totalPrice }),
                status: 'SUCCESS'
            }
        });

        revalidatePath('/inventory');
        revalidatePath('/reports');
        revalidatePath('/'); // Update Dashboard

        return { success: true, message: '記錄已儲存' };

    } catch (error) {
        console.error('Create Entry Error:', error);
        return { success: false, message: '儲存失敗，請稍後再試' };
    }
}

export async function getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 取得今日營收 (從 Revenue 表)
    const revenueData = await prisma.revenue.aggregate({
        where: {
            date: {
                gte: today,
                lt: tomorrow
            }
        },
        _sum: {
            amount: true
        }
    });

    // 取得今日支出 (從 Entry 表)
    const expenseData = await prisma.entry.aggregate({
        where: {
            date: {
                gte: today,
                lt: tomorrow
            },
            // type: 'EXPENSE' // 其實進貨也算支出，這裡應該是總成本
        },
        _sum: {
            totalPrice: true
        }
    });

    return {
        revenue: revenueData._sum.amount || 0,
        cost: expenseData._sum.totalPrice || 0,
        profit: (revenueData._sum.amount || 0) - (expenseData._sum.totalPrice || 0)
    };
}

export async function updateEntry(id: string, formData: FormData) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, message: auth.error };
        const user = auth.user;

        const type = formData.get('type') as string;
        const dateInput = formData.get('date') as string | null;
        const date = parseLocalDate(dateInput) ?? new Date();
        const note = (formData.get('note') as string | null)?.trim();

        if (type === 'PURCHASE') {
            const itemId = formData.get('itemId') as string;
            const vendorId = formData.get('vendorId') as string;
            const weight = Number.parseFloat(formData.get('weight') as string);
            const unit = (formData.get('unit') as string | null) ?? 'kg';
            const price = Number.parseFloat(formData.get('price') as string);

            if (!itemId || !Number.isFinite(weight) || !Number.isFinite(price) || weight <= 0 || price < 0) {
                return { success: false, message: '請填寫完整進貨資訊' };
            }

            const unitRow = await prisma.dictionary.findUnique({
                where: { category_value: { category: 'unit', value: unit } },
            });
            const unitMeta = parseUnitMeta(unitRow?.meta);
            const unitDef: UnitDef | undefined = unitRow
                ? {
                    code: unitRow.value,
                    name: unitRow.label,
                    isWeight: unitMeta.isWeight ?? typeof unitMeta.toKg === 'number',
                    toKg: unitMeta.toKg,
                }
                : UNITS.find((item) => item.code === unit);
            const standardWeight = unitDef
                ? convertToKg(weight, unitDef.code, [unitDef])
                : null;

            await prisma.entry.update({
                where: { id },
                data: {
                    date,
                    itemId,
                    vendorId: vendorId === 'none' ? null : vendorId,
                    inputQuantity: weight,
                    inputUnit: unit,
                    standardWeight,
                    totalPrice: price,
                    unitPrice: standardWeight ? price / standardWeight : price / weight,
                    note: note || null,
                },
            });
        } else {
            const expenseType = formData.get('expenseType') as string;
            const amount = Number.parseFloat(formData.get('amount') as string);
            if (!expenseType || !Number.isFinite(amount) || amount < 0) {
                return { success: false, message: '請填寫完整支出資訊' };
            }

            await prisma.entry.update({
                where: { id },
                data: {
                    date,
                    expenseType,
                    totalPrice: amount,
                    note: note || null,
                },
            });
        }

        await prisma.operationLog.create({
            data: {
                action: 'UPDATE',
                module: 'ENTRY',
                userId: user.id,
                target: id,
                details: JSON.stringify({ type, amount: formData.get('price') || formData.get('amount') }),
                status: 'SUCCESS',
            },
        });

        revalidatePath('/inventory');
        revalidatePath('/reports');
        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Update Entry Error:', error);
        return { success: false, message: '更新失敗，請稍後再試' };
    }
}

export async function deleteEntry(id: string) {
    try {
        const auth = await ensureRole('write');
        if (!auth.ok) return { success: false, message: auth.error };
        const user = auth.user;

        const entry = await prisma.entry.findUnique({
            where: { id },
            include: { item: true, vendor: true },
        });
        if (!entry) {
            return { success: false, message: '記錄不存在或已刪除' };
        }

        await prisma.entry.delete({ where: { id } });

        await prisma.operationLog.create({
            data: {
                action: 'DELETE',
                module: 'ENTRY',
                userId: user.id,
                target: id,
                details: JSON.stringify({
                    type: entry.type,
                    item: entry.item?.name || null,
                    vendor: entry.vendor?.name || null,
                    expenseType: entry.expenseType,
                    amount: entry.totalPrice,
                }),
                status: 'SUCCESS',
            },
        });

        revalidatePath('/inventory');
        revalidatePath('/reports');
        revalidatePath('/');
        return { success: true };
    } catch (error) {
        console.error('Delete Entry Error:', error);
        return { success: false, message: '刪除失敗，請稍後再試' };
    }
}
