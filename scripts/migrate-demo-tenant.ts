/**
 * 展示企業遷移腳本
 *
 * 執行內容：
 * 1. 建立獨立的展示企業 (demo tenant)
 * 2. 將 viewer 帳號移到展示企業
 * 3. 在展示企業建立場所、類別、廠商、品項，並產生假資料
 * 4. 清理原始企業中所有的假資料殘留
 *
 * 執行：npx tsx scripts/migrate-demo-tenant.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORIG_TENANT_ID = "cml8xdpx20000cfyo23pu6cbm";
const DEMO_START = "2025-07-01";
const DEMO_END   = "2026-02-07";

const DEMO_CATEGORY_NAMES = ["飲料原料", "包材耗材", "輕食材料"];
const DEMO_VENDOR_NAMES   = ["台茶原料行", "正大乳品", "豐田包材", "晨光食品", "咖啡職人", "鮮果批發市場"];
const DEMO_EXPENSE_VALUES = ["RENT_DEMO", "UTIL_DEMO", "WAGE_DEMO", "REPAIR_DEMO", "MKT_DEMO", "CLEAN_DEMO"];

// ── 固定種子隨機（與 seed-demo-data.ts 相同，確保資料一致） ──
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
function pick<T>(arr: T[]): T { return arr[rand(0, arr.length - 1)]; }

function dateRange(start: string, end: string): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    return dates;
}

function utcDate(d: Date, time = "00:00:00") {
    return new Date(`${d.toISOString().slice(0, 10)}T${time}.000Z`);
}

async function main() {
    console.log("=== 展示企業遷移腳本 ===\n");

    // ── Step 1：建立展示企業 ─────────────────────────────
    console.log("[1/5] 建立展示企業...");
    const demoTenant = await prisma.tenant.upsert({
        where:  { code: "demo" },
        update: {},
        create: { name: "飲料展示企業", code: "demo", status: true, note: "對外展示用，使用飲料店假資料" },
    });
    console.log(`  完成：${demoTenant.name} (${demoTenant.id})`);

    // ── Step 2：移動 viewer 到展示企業 ───────────────────
    console.log("\n[2/5] 移動 viewer 到展示企業...");
    const viewer = await prisma.user.findFirst({ where: { username: "viewer" } });
    if (!viewer) { console.error("  找不到 viewer 帳號！"); process.exit(1); }
    await prisma.user.update({ where: { id: viewer.id }, data: { tenantId: demoTenant.id } });
    console.log("  viewer -> 展示企業");

    // ── Step 3：在展示企業建立場所、資料目錄、產生假資料 ─
    console.log("\n[3/5] 在展示企業建立資料並產生假資料...");
    const tenantId = demoTenant.id;

    // 場所
    const loc1 = await prisma.location.upsert({
        where:  { name_tenantId: { name: "屏東攤位", tenantId } },
        update: {},
        create: { name: "屏東攤位", isActive: true, tenantId },
    });
    const loc2 = await prisma.location.upsert({
        where:  { name_tenantId: { name: "潮州攤位", tenantId } },
        update: {},
        create: { name: "潮州攤位", isActive: true, tenantId },
    });
    const locations = [loc1, loc2];

    // 類別
    const catDrink = await prisma.category.upsert({
        where: { name_tenantId: { name: "飲料原料", tenantId } }, update: {},
        create: { name: "飲料原料", sortOrder: 10, tenantId },
    });
    const catPkg = await prisma.category.upsert({
        where: { name_tenantId: { name: "包材耗材", tenantId } }, update: {},
        create: { name: "包材耗材", sortOrder: 11, tenantId },
    });
    const catFood = await prisma.category.upsert({
        where: { name_tenantId: { name: "輕食材料", tenantId } }, update: {},
        create: { name: "輕食材料", sortOrder: 12, tenantId },
    });

    // 廠商
    const vendors: Record<string, string> = {};
    for (const v of [
        { name: "台茶原料行", note: "茶葉、珍珠專業供應商" },
        { name: "正大乳品",   note: "鮮乳、奶精、乳製品" },
        { name: "豐田包材",   note: "杯子、吸管、封口膜" },
        { name: "晨光食品",   note: "糖漿、果醬、配料" },
        { name: "咖啡職人",   note: "咖啡豆進口商" },
        { name: "鮮果批發市場", note: "新鮮水果每日配送" },
    ]) {
        const rec = await prisma.vendor.upsert({
            where: { name_tenantId: { name: v.name, tenantId } }, update: {},
            create: { name: v.name, note: v.note, isActive: true, tenantId },
        });
        vendors[v.name] = rec.id;
    }

    // 品項
    const items: Record<string, { id: string; unit: string; avgPrice: number }> = {};
    const itemDefs = [
        { name: "四季春茶葉",      cat: catDrink.id, unit: "kg",     avgPrice: 380 },
        { name: "大葉烏龍茶葉",    cat: catDrink.id, unit: "kg",     avgPrice: 420 },
        { name: "阿薩姆紅茶葉",    cat: catDrink.id, unit: "kg",     avgPrice: 320 },
        { name: "咖啡豆(耶加雪菲)", cat: catDrink.id, unit: "kg",    avgPrice: 850 },
        { name: "咖啡豆(巴西日曬)", cat: catDrink.id, unit: "kg",    avgPrice: 680 },
        { name: "黑糖珍珠",        cat: catDrink.id, unit: "bag",    avgPrice: 280 },
        { name: "白珍珠",          cat: catDrink.id, unit: "bag",    avgPrice: 240 },
        { name: "燕麥奶",          cat: catDrink.id, unit: "pack",   avgPrice: 420 },
        { name: "鮮乳",            cat: catDrink.id, unit: "pack",   avgPrice: 260 },
        { name: "黑糖糖漿",        cat: catDrink.id, unit: "pack",   avgPrice: 180 },
        { name: "果糖",            cat: catDrink.id, unit: "bucket", avgPrice: 380 },
        { name: "700ml 透明杯",    cat: catPkg.id,   unit: "pack",   avgPrice: 320 },
        { name: "500ml 透明杯",    cat: catPkg.id,   unit: "pack",   avgPrice: 280 },
        { name: "粗吸管",          cat: catPkg.id,   unit: "pack",   avgPrice: 150 },
        { name: "細吸管",          cat: catPkg.id,   unit: "pack",   avgPrice: 120 },
        { name: "封口膜",          cat: catPkg.id,   unit: "pack",   avgPrice: 480 },
        { name: "提袋",            cat: catPkg.id,   unit: "pack",   avgPrice: 220 },
        { name: "芒果",            cat: catFood.id,  unit: "box",    avgPrice: 480 },
        { name: "草莓",            cat: catFood.id,  unit: "box",    avgPrice: 580 },
        { name: "奇異果",          cat: catFood.id,  unit: "box",    avgPrice: 380 },
        { name: "百香果",          cat: catFood.id,  unit: "box",    avgPrice: 320 },
    ];
    for (const def of itemDefs) {
        const rec = await prisma.item.upsert({
            where: { name_categoryId_tenantId: { name: def.name, categoryId: def.cat, tenantId } },
            update: {},
            create: { name: def.name, categoryId: def.cat, defaultUnit: def.unit, sortOrder: 10, isActive: true, tenantId },
        });
        items[def.name] = { id: rec.id, unit: def.unit, avgPrice: def.avgPrice };
    }

    // 支出類型
    const expTypes: Record<string, string> = {};
    for (const e of [
        { label: "店面租金", value: "RENT_DEMO", sortOrder: 20 },
        { label: "水電費",   value: "UTIL_DEMO", sortOrder: 21 },
        { label: "員工薪資", value: "WAGE_DEMO", sortOrder: 22 },
        { label: "設備維修", value: "REPAIR_DEMO", sortOrder: 23 },
        { label: "行銷費用", value: "MKT_DEMO",  sortOrder: 24 },
        { label: "清潔費",   value: "CLEAN_DEMO", sortOrder: 25 },
    ]) {
        const rec = await prisma.dictionary.upsert({
            where: { category_value_tenantId: { category: "expense_type", value: e.value, tenantId } },
            update: {},
            create: { category: "expense_type", label: e.label, value: e.value, sortOrder: e.sortOrder, isActive: true, tenantId },
        });
        expTypes[e.value] = rec.id;
    }

    // 產生每日資料
    const dates = dateRange(DEMO_START, DEMO_END);
    let revenueCount = 0, entryCount = 0;

    for (const date of dates) {
        const dow = date.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const month = date.getMonth() + 1;
        const seasonMult = [7, 8, 9, 1, 2].includes(month) ? 1.3 : [11, 12].includes(month) ? 0.8 : 1.0;
        const isDayOff = date.getDate() === 1 && dow === 1;

        // 營收
        for (const loc of locations) {
            const base = isWeekend ? randFloat(18000, 28000) : randFloat(12000, 20000);
            const amount = Math.round(base * seasonMult / 100) * 100;
            await prisma.revenue.upsert({
                where: { date_locationId_tenantId: { date: utcDate(date), locationId: loc.id, tenantId } },
                update: {},
                create: { date: utcDate(date), locationId: loc.id, amount: isDayOff ? 0 : amount, isDayOff, tenantId },
            });
            revenueCount++;
        }

        // 進貨
        const shouldPurchase = dow === 1 || (dow === 4 && rand(0, 1) === 1) || date.getDate() === 15;
        if (shouldPurchase) {
            for (const name of ["四季春茶葉", "大葉烏龍茶葉", "阿薩姆紅茶葉"]) {
                if (rand(0, 2) === 0) continue;
                const item = items[name]; const qty = rand(2, 8);
                await prisma.entry.create({ data: { date: utcDate(date, "08:00:00"), type: "PURCHASE", status: "APPROVED", itemId: item.id, vendorId: vendors["台茶原料行"], inputQuantity: qty, inputUnit: item.unit, totalPrice: item.avgPrice * qty + rand(-30, 80), tenantId } });
                entryCount++;
            }
            if (rand(0, 1) === 0) {
                const name = pick(["咖啡豆(耶加雪菲)", "咖啡豆(巴西日曬)"]); const item = items[name]; const qty = rand(3, 10);
                await prisma.entry.create({ data: { date: utcDate(date, "08:30:00"), type: "PURCHASE", status: "APPROVED", itemId: item.id, vendorId: vendors["咖啡職人"], inputQuantity: qty, inputUnit: item.unit, totalPrice: item.avgPrice * qty + rand(-50, 100), tenantId } });
                entryCount++;
            }
            for (const name of ["700ml 透明杯", "封口膜", "粗吸管"]) {
                if (rand(0, 3) !== 0 && dow !== 1) continue;
                const item = items[name]; const qty = rand(2, 6);
                await prisma.entry.create({ data: { date: utcDate(date, "09:00:00"), type: "PURCHASE", status: "APPROVED", itemId: item.id, vendorId: vendors["豐田包材"], inputQuantity: qty, inputUnit: item.unit, totalPrice: item.avgPrice * qty + rand(-20, 50), tenantId } });
                entryCount++;
            }
        }

        // 每日小補
        if (!isDayOff) {
            const dailyItems: { name: string; vendor: string }[] = [
                { name: "鮮乳", vendor: "正大乳品" },
                { name: "黑糖珍珠", vendor: "台茶原料行" },
            ];
            if (isWeekend || month === 8 || month === 1) {
                dailyItems.push({ name: pick(["芒果", "草莓", "奇異果", "百香果"]), vendor: "鮮果批發市場" });
            }
            for (const { name, vendor } of dailyItems) {
                if (rand(0, 2) === 0) continue;
                const item = items[name]; const qty = rand(1, 4);
                await prisma.entry.create({ data: { date: utcDate(date, "07:00:00"), type: "PURCHASE", status: "APPROVED", itemId: item.id, vendorId: vendors[vendor], inputQuantity: qty, inputUnit: item.unit, totalPrice: item.avgPrice * qty + rand(-10, 30), tenantId } });
                entryCount++;
            }
        }

        // 月固定支出
        if (date.getDate() === 5)  { await prisma.entry.create({ data: { date: utcDate(date, "10:00:00"), type: "EXPENSE", status: "APPROVED", expenseType: "RENT_DEMO", totalPrice: rand(25000, 30000), note: `${month}月租金`, tenantId } }); entryCount++; }
        if (date.getDate() === 10) { await prisma.entry.create({ data: { date: utcDate(date, "10:00:00"), type: "EXPENSE", status: "APPROVED", expenseType: "UTIL_DEMO", totalPrice: randFloat(3500, 6500), note: `${month}月水電`, tenantId } }); entryCount++; }
        if (date.getDate() === 25) { await prisma.entry.create({ data: { date: utcDate(date, "10:00:00"), type: "EXPENSE", status: "APPROVED", expenseType: "WAGE_DEMO", totalPrice: randFloat(45000, 60000), note: `${month}月薪資`, tenantId } }); entryCount++; }
        if (dow === 3 && rand(0, 3) === 0) { await prisma.entry.create({ data: { date: utcDate(date, "11:00:00"), type: "EXPENSE", status: "APPROVED", expenseType: pick(["CLEAN_DEMO", "MKT_DEMO", "REPAIR_DEMO"]), totalPrice: randFloat(800, 4000), tenantId } }); entryCount++; }
    }
    console.log(`  完成：營收 ${revenueCount} 筆，進貨/支出 ${entryCount} 筆`);

    // ── Step 4：清理原始企業的假資料 ────────────────────
    console.log("\n[4/5] 清理原始企業的假資料...");

    // 找出假資料的 ID
    const origDemoCats   = await prisma.category.findMany({ where: { tenantId: ORIG_TENANT_ID, name: { in: DEMO_CATEGORY_NAMES } }, select: { id: true } });
    const origDemoCatIds = origDemoCats.map(c => c.id);
    const origDemoItems  = await prisma.item.findMany({ where: { tenantId: ORIG_TENANT_ID, categoryId: { in: origDemoCatIds } }, select: { id: true } });
    const origDemoItemIds = origDemoItems.map(i => i.id);
    const origDemoVendors = await prisma.vendor.findMany({ where: { tenantId: ORIG_TENANT_ID, name: { in: DEMO_VENDOR_NAMES } }, select: { id: true } });
    const origDemoVendorIds = origDemoVendors.map(v => v.id);

    // 刪除假進貨/支出記錄
    const d1 = await prisma.entry.deleteMany({ where: { tenantId: ORIG_TENANT_ID, OR: [{ itemId: { in: origDemoItemIds } }, { vendorId: { in: origDemoVendorIds } }, { expenseType: { in: DEMO_EXPENSE_VALUES } }] } });
    console.log(`  刪除假進貨/支出：${d1.count} 筆`);

    // 刪除假品項
    const d2 = await prisma.item.deleteMany({ where: { id: { in: origDemoItemIds } } });
    console.log(`  刪除假品項：${d2.count} 筆`);

    // 刪除假類別
    const d3 = await prisma.category.deleteMany({ where: { id: { in: origDemoCatIds } } });
    console.log(`  刪除假類別：${d3.count} 筆`);

    // 刪除假廠商
    const d4 = await prisma.vendor.deleteMany({ where: { id: { in: origDemoVendorIds } } });
    console.log(`  刪除假廠商：${d4.count} 筆`);

    // 刪除假支出類型
    const d5 = await prisma.dictionary.deleteMany({ where: { tenantId: ORIG_TENANT_ID, value: { in: DEMO_EXPENSE_VALUES } } });
    console.log(`  刪除假支出類型：${d5.count} 筆`);

    // 刪除假營收（全部都是假的，2025-07-01 之前無任何記錄）
    const d6 = await prisma.revenue.deleteMany({ where: { tenantId: ORIG_TENANT_ID } });
    console.log(`  刪除假營收：${d6.count} 筆`);

    // ── Step 5：驗證結果 ─────────────────────────────────
    console.log("\n[5/5] 驗證結果...");
    const origEntries  = await prisma.entry.count({ where: { tenantId: ORIG_TENANT_ID } });
    const origRevenues = await prisma.revenue.count({ where: { tenantId: ORIG_TENANT_ID } });
    const demoEntries  = await prisma.entry.count({ where: { tenantId: demoTenant.id } });
    const demoRevenues = await prisma.revenue.count({ where: { tenantId: demoTenant.id } });
    console.log(`  原始企業 (mom)  → 進貨/支出: ${origEntries} 筆，營收: ${origRevenues} 筆`);
    console.log(`  展示企業 (viewer) → 進貨/支出: ${demoEntries} 筆，營收: ${demoRevenues} 筆`);

    console.log("\n=== 遷移完成 ===");
    console.log(`展示企業 ID: ${demoTenant.id}`);
    console.log("請更新 seed-demo-data.ts 中的 tenantId 為上方 ID（未來重跑時用）");
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
