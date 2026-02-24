/**
 * 展示用假資料產生腳本
 * 產生約 7 個月（2025-07-01 ~ 2026-02-07）的模擬資料
 * 業態：飲料店（珍珠奶茶、咖啡、鮮果汁）
 * 執行：npx tsx scripts/seed-demo-data.ts
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

// ─── 固定種子隨機（可重現） ───────────────────────────
let seed = 42;
function rand(min: number, max: number) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    const n = (seed >>> 0) / 0xffffffff;
    return Math.floor(n * (max - min + 1)) + min;
}
function randFloat(min: number, max: number) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    const n = (seed >>> 0) / 0xffffffff;
    return +(min + n * (max - min)).toFixed(0);
}
function pick<T>(arr: T[]): T {
    return arr[rand(0, arr.length - 1)];
}

// ─── 日期工具 ─────────────────────────────────────────
function dateRange(start: string, end: string): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
        dates.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

function dayOfWeek(d: Date) { return d.getDay(); } // 0=Sun

async function main() {
    const tenantId = "cml8xdpx20000cfyo23pu6cbm";
    const START = "2025-07-01";
    const END   = "2026-02-07";

    console.log("=== 開始產生展示資料 ===");
    console.log(`期間：${START} ~ ${END}`);

    // ─── 1. 新增類別 ──────────────────────────────────
    const catDrink = await prisma.category.upsert({
        where: { name_tenantId: { name: "飲料原料", tenantId } },
        update: {},
        create: { name: "飲料原料", sortOrder: 10, tenantId },
    });
    const catPkg = await prisma.category.upsert({
        where: { name_tenantId: { name: "包材耗材", tenantId } },
        update: {},
        create: { name: "包材耗材", sortOrder: 11, tenantId },
    });
    const catFood = await prisma.category.upsert({
        where: { name_tenantId: { name: "輕食材料", tenantId } },
        update: {},
        create: { name: "輕食材料", sortOrder: 12, tenantId },
    });
    console.log("✓ 類別建立完成");

    // ─── 2. 新增廠商 ──────────────────────────────────
    const vendors: Record<string, string> = {};
    const vendorList = [
        { name: "台茶原料行", note: "茶葉、珍珠專業供應商" },
        { name: "正大乳品", note: "鮮乳、奶精、乳製品" },
        { name: "豐田包材", note: "杯子、吸管、封口膜" },
        { name: "晨光食品", note: "糖漿、果醬、配料" },
        { name: "咖啡職人", note: "咖啡豆進口商" },
        { name: "鮮果批發市場", note: "新鮮水果每日配送" },
    ];
    for (const v of vendorList) {
        const rec = await prisma.vendor.upsert({
            where: { name_tenantId: { name: v.name, tenantId } },
            update: {},
            create: { name: v.name, note: v.note, isActive: true, tenantId },
        });
        vendors[v.name] = rec.id;
    }
    console.log("✓ 廠商建立完成");

    // ─── 3. 新增品項 ──────────────────────────────────
    const items: Record<string, { id: string; unit: string; avgPrice: number }> = {};

    const itemDefs = [
        // 飲料原料
        { name: "四季春茶葉", cat: catDrink.id, unit: "kg", avgPrice: 380 },
        { name: "大葉烏龍茶葉", cat: catDrink.id, unit: "kg", avgPrice: 420 },
        { name: "阿薩姆紅茶葉", cat: catDrink.id, unit: "kg", avgPrice: 320 },
        { name: "咖啡豆(耶加雪菲)", cat: catDrink.id, unit: "kg", avgPrice: 850 },
        { name: "咖啡豆(巴西日曬)", cat: catDrink.id, unit: "kg", avgPrice: 680 },
        { name: "黑糖珍珠", cat: catDrink.id, unit: "bag", avgPrice: 280 },
        { name: "白珍珠", cat: catDrink.id, unit: "bag", avgPrice: 240 },
        { name: "燕麥奶", cat: catDrink.id, unit: "pack", avgPrice: 420 },
        { name: "鮮乳", cat: catDrink.id, unit: "pack", avgPrice: 260 },
        { name: "黑糖糖漿", cat: catDrink.id, unit: "pack", avgPrice: 180 },
        { name: "果糖", cat: catDrink.id, unit: "bucket", avgPrice: 380 },
        // 包材耗材
        { name: "700ml 透明杯", cat: catPkg.id, unit: "pack", avgPrice: 320 },
        { name: "500ml 透明杯", cat: catPkg.id, unit: "pack", avgPrice: 280 },
        { name: "粗吸管", cat: catPkg.id, unit: "pack", avgPrice: 150 },
        { name: "細吸管", cat: catPkg.id, unit: "pack", avgPrice: 120 },
        { name: "封口膜", cat: catPkg.id, unit: "pack", avgPrice: 480 },
        { name: "提袋", cat: catPkg.id, unit: "pack", avgPrice: 220 },
        // 輕食材料
        { name: "芒果", cat: catFood.id, unit: "box", avgPrice: 480 },
        { name: "草莓", cat: catFood.id, unit: "box", avgPrice: 580 },
        { name: "奇異果", cat: catFood.id, unit: "box", avgPrice: 380 },
        { name: "百香果", cat: catFood.id, unit: "box", avgPrice: 320 },
    ];

    for (const def of itemDefs) {
        const rec = await prisma.item.upsert({
            where: { name_categoryId_tenantId: { name: def.name, categoryId: def.cat, tenantId } },
            update: {},
            create: {
                name: def.name,
                categoryId: def.cat,
                defaultUnit: def.unit,
                sortOrder: 10,
                isActive: true,
                tenantId,
            },
        });
        items[def.name] = { id: rec.id, unit: def.unit, avgPrice: def.avgPrice };
    }
    console.log("✓ 品項建立完成");

    // ─── 4. 新增支出類型 (字典) ───────────────────────
    const expenseDefs = [
        { label: "店面租金",   value: "RENT_DEMO",    meta: null, sortOrder: 20 },
        { label: "水電費",     value: "UTIL_DEMO",    meta: null, sortOrder: 21 },
        { label: "員工薪資",   value: "WAGE_DEMO",    meta: null, sortOrder: 22 },
        { label: "設備維修",   value: "REPAIR_DEMO",  meta: null, sortOrder: 23 },
        { label: "行銷費用",   value: "MKT_DEMO",     meta: null, sortOrder: 24 },
        { label: "清潔費",     value: "CLEAN_DEMO",   meta: null, sortOrder: 25 },
    ];
    const expTypes: Record<string, string> = {};
    for (const e of expenseDefs) {
        const rec = await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: "expense_type", value: e.value, tenantId } },
            update: {},
            create: { category: "expense_type", label: e.label, value: e.value, sortOrder: e.sortOrder, isActive: true, tenantId },
        });
        expTypes[e.value] = rec.id;
    }
    console.log("✓ 支出類型建立完成");

    // ─── 5. 取得場所 ──────────────────────────────────
    const locations = await prisma.location.findMany({ where: { tenantId } });
    if (locations.length === 0) {
        console.error("找不到場所，請先執行 prisma db seed");
        process.exit(1);
    }

    // ─── 6. 產生每日資料 ──────────────────────────────
    const dates = dateRange(START, END);
    console.log(`產生 ${dates.length} 天的資料...`);

    let revenueCount = 0;
    let entryCount   = 0;

    for (const date of dates) {
        const dow    = dayOfWeek(date);
        const isWeekend = dow === 0 || dow === 6;
        const month  = date.getMonth() + 1; // 1-12
        // 旺季：7-9月、1-2月; 淡季：11-12月
        const seasonMult = [7, 8, 9, 1, 2].includes(month) ? 1.3
                         : [11, 12].includes(month) ? 0.8 : 1.0;
        // 每月 1~2 天休假
        const isDayOff = date.getDate() === 1 && dow === 1; // 週一+1號休

        // ── 營收 ──────────────────────────────────────
        for (const loc of locations) {
            const base = isWeekend
                ? randFloat(18000, 28000)
                : randFloat(12000, 20000);
            const amount = Math.round(base * seasonMult / 100) * 100;
            await prisma.revenue.upsert({
                where: { date_locationId_tenantId: {
                    date: new Date(date.toISOString().slice(0, 10) + "T00:00:00.000Z"),
                    locationId: loc.id,
                    tenantId,
                }},
                update: {},
                create: {
                    date: new Date(date.toISOString().slice(0, 10) + "T00:00:00.000Z"),
                    locationId: loc.id,
                    amount: isDayOff ? 0 : amount,
                    isDayOff,
                    tenantId,
                },
            });
            revenueCount++;
        }

        // ── 進貨（每週一次大量補貨 + 每日小補） ──────
        const shouldPurchase = dow === 1 // 週一大量進貨
            || (dow === 4 && rand(0, 1) === 1) // 週四補貨
            || (date.getDate() === 15); // 每月15日定期

        if (shouldPurchase) {
            // 茶葉類
            const teaItems = ["四季春茶葉", "大葉烏龍茶葉", "阿薩姆紅茶葉"];
            for (const name of teaItems) {
                if (rand(0, 2) === 0) continue; // 隨機略過
                const item = items[name];
                const qty  = rand(2, 8);
                const price = item.avgPrice * qty + rand(-30, 80);
                await prisma.entry.create({
                    data: {
                        date: new Date(date.toISOString().slice(0, 10) + "T08:00:00.000Z"),
                        type: "PURCHASE",
                        status: "APPROVED",
                        itemId: item.id,
                        vendorId: vendors["台茶原料行"],
                        inputQuantity: qty,
                        inputUnit: item.unit,
                        totalPrice: price,
                        tenantId,
                    },
                });
                entryCount++;
            }
            // 咖啡豆
            if (rand(0, 1) === 0) {
                const coffees = ["咖啡豆(耶加雪菲)", "咖啡豆(巴西日曬)"];
                const name = pick(coffees);
                const item = items[name];
                const qty  = rand(3, 10);
                await prisma.entry.create({
                    data: {
                        date: new Date(date.toISOString().slice(0, 10) + "T08:30:00.000Z"),
                        type: "PURCHASE",
                        status: "APPROVED",
                        itemId: item.id,
                        vendorId: vendors["咖啡職人"],
                        inputQuantity: qty,
                        inputUnit: item.unit,
                        totalPrice: item.avgPrice * qty + rand(-50, 100),
                        tenantId,
                    },
                });
                entryCount++;
            }
            // 包材
            const pkgItems = ["700ml 透明杯", "封口膜", "粗吸管"];
            for (const name of pkgItems) {
                if (rand(0, 3) !== 0 && dow !== 1) continue;
                const item = items[name];
                const qty  = rand(2, 6);
                await prisma.entry.create({
                    data: {
                        date: new Date(date.toISOString().slice(0, 10) + "T09:00:00.000Z"),
                        type: "PURCHASE",
                        status: "APPROVED",
                        itemId: item.id,
                        vendorId: vendors["豐田包材"],
                        inputQuantity: qty,
                        inputUnit: item.unit,
                        totalPrice: item.avgPrice * qty + rand(-20, 50),
                        tenantId,
                    },
                });
                entryCount++;
            }
        }

        // ── 每日小補（鮮乳、珍珠、水果） ─────────────
        if (!isDayOff) {
            const dailyItems: Array<{ name: string; vendor: string }> = [
                { name: "鮮乳",    vendor: "正大乳品" },
                { name: "黑糖珍珠", vendor: "台茶原料行" },
            ];
            if (isWeekend || month === 8 || month === 1) {
                const fruitItems = ["芒果", "草莓", "奇異果", "百香果"];
                dailyItems.push({ name: pick(fruitItems), vendor: "鮮果批發市場" });
            }
            for (const { name, vendor } of dailyItems) {
                if (rand(0, 2) === 0) continue;
                const item = items[name];
                const qty  = rand(1, 4);
                await prisma.entry.create({
                    data: {
                        date: new Date(date.toISOString().slice(0, 10) + "T07:00:00.000Z"),
                        type: "PURCHASE",
                        status: "APPROVED",
                        itemId: item.id,
                        vendorId: vendors[vendor],
                        inputQuantity: qty,
                        inputUnit: item.unit,
                        totalPrice: item.avgPrice * qty + rand(-10, 30),
                        tenantId,
                    },
                });
                entryCount++;
            }
        }

        // ── 支出（月固定 + 不定期） ───────────────────
        // 月初固定支出
        if (date.getDate() === 5) {
            // 租金（每月5日）
            await prisma.entry.create({
                data: {
                    date: new Date(date.toISOString().slice(0, 10) + "T10:00:00.000Z"),
                    type: "EXPENSE",
                    status: "APPROVED",
                    expenseType: "RENT_DEMO",
                    totalPrice: rand(25000, 30000),
                    note: `${date.getMonth() + 1}月租金`,
                    tenantId,
                },
            });
            entryCount++;
        }
        if (date.getDate() === 10) {
            // 水電費（每月10日）
            await prisma.entry.create({
                data: {
                    date: new Date(date.toISOString().slice(0, 10) + "T10:00:00.000Z"),
                    type: "EXPENSE",
                    status: "APPROVED",
                    expenseType: "UTIL_DEMO",
                    totalPrice: randFloat(3500, 6500),
                    note: `${date.getMonth() + 1}月水電`,
                    tenantId,
                },
            });
            entryCount++;
        }
        if (date.getDate() === 25) {
            // 薪資（每月25日）
            await prisma.entry.create({
                data: {
                    date: new Date(date.toISOString().slice(0, 10) + "T10:00:00.000Z"),
                    type: "EXPENSE",
                    status: "APPROVED",
                    expenseType: "WAGE_DEMO",
                    totalPrice: randFloat(45000, 60000),
                    note: `${date.getMonth() + 1}月薪資`,
                    tenantId,
                },
            });
            entryCount++;
        }
        // 不定期：清潔、行銷、維修
        if (dow === 3 && rand(0, 3) === 0) {
            await prisma.entry.create({
                data: {
                    date: new Date(date.toISOString().slice(0, 10) + "T11:00:00.000Z"),
                    type: "EXPENSE",
                    status: "APPROVED",
                    expenseType: pick(["CLEAN_DEMO", "MKT_DEMO", "REPAIR_DEMO"]),
                    totalPrice: randFloat(800, 4000),
                    tenantId,
                },
            });
            entryCount++;
        }
    }

    console.log(`✓ 營收記錄：${revenueCount} 筆`);
    console.log(`✓ 進貨/支出：${entryCount} 筆`);
    console.log("=== 展示資料產生完成 ===");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
