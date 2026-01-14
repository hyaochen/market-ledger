import prisma from "@/lib/prisma";
import { parseLocalDate, formatDateInput } from "@/lib/date";
import { getUnitLabel } from "@/lib/units";
import { getUnits } from "@/app/actions/catalog";
import { getCurrentUser } from "@/lib/auth";

function csvEscape(value: string | number | null | undefined) {
    const text = `${value ?? ""}`;
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "entries";
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    const today = new Date();
    const defaultFrom = new Date(today);
    defaultFrom.setDate(defaultFrom.getDate() - 6);

    const fromDate = parseLocalDate(fromParam) ?? defaultFrom;
    const toDate = parseLocalDate(toParam) ?? today;

    const fromStart = new Date(fromDate);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(toDate);
    toEnd.setHours(23, 59, 59, 999);

    if (type === "revenues") {
        const revenues = await prisma.revenue.findMany({
            where: { date: { gte: fromStart, lte: toEnd } },
            include: { location: true },
            orderBy: { date: "asc" },
        });

        const rows = [
            ["日期", "地點", "金額", "是否休假"],
            ...revenues.map((record) => [
                formatDateInput(record.date),
                record.location?.name || "",
                record.isDayOff ? "0" : record.amount.toString(),
                record.isDayOff ? "是" : "否",
            ]),
        ];

        const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
        return new Response(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename=revenues_${formatDateInput(fromStart)}_${formatDateInput(toEnd)}.csv`,
            },
        });
    }

    const [entries, expenseTypes, units] = await Promise.all([
        prisma.entry.findMany({
            where: { date: { gte: fromStart, lte: toEnd } },
            include: { item: true, vendor: true },
            orderBy: { date: "asc" },
        }),
        prisma.dictionary.findMany({ where: { category: "expense_type" } }),
        getUnits(),
    ]);

    const expenseMap = new Map(expenseTypes.map((item) => [item.value, item.label]));

    const rows = [
        ["日期", "類型", "品項/支出", "廠商", "數量", "單位", "金額", "備註"],
        ...entries.map((entry) => [
            formatDateInput(entry.date),
            entry.type === "PURCHASE" ? "進貨" : "支出",
            entry.type === "PURCHASE"
                ? entry.item?.name || ""
                : expenseMap.get(entry.expenseType || "") || entry.expenseType || "",
            entry.vendor?.name || "",
            entry.inputQuantity ?? "",
            entry.inputUnit ? getUnitLabel(entry.inputUnit, units) : "",
            entry.totalPrice.toString(),
            entry.note || "",
        ]),
    ];

    const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
    return new Response(csv, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename=entries_${formatDateInput(fromStart)}_${formatDateInput(toEnd)}.csv`,
        },
    });
}
