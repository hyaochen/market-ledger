import type { UnitDef } from "@/lib/units";

export const PIE_COLORS = ["#F97316", "#22C55E", "#0EA5E9", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981"];

export type ReportsClientProps = {
    roleCode: "read" | "write" | "admin";
    earliestDate?: string | null;
    range: { from: string; to: string };
    totals: { revenue: number; cost: number; profit: number; avgDailyRevenue: number; businessDayCount: number };
    dailyStats: { date: string; revenue: number; cost: number }[];
    topItems: { name: string; totalCost: number; totalWeightKg: number; totalQuantity: number; unit: string }[];
    expenseBreakdown: { type: string; label: string; total: number }[];
    entries: {
        id: string;
        type: string;
        date: string;
        itemId: string;
        itemName: string;
        vendorId: string;
        vendorName: string;
        inputQuantity: number;
        inputUnit: string;
        totalPrice: number;
        expenseType: string;
        note: string;
    }[];
    revenues: {
        id: string;
        date: string;
        locationId: string;
        locationName: string;
        amount: number;
        isDayOff: boolean;
    }[];
    items: { id: string; name: string; categoryId: string; defaultUnit: string; isActive: boolean }[];
    vendors: { id: string; name: string; isActive: boolean }[];
    expenseTypes: { value: string; label: string }[];
    units: UnitDef[];
};

export type EntryRow = ReportsClientProps["entries"][number];
export type RevenueRow = ReportsClientProps["revenues"][number];
