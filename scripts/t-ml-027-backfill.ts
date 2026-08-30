// T-ML-027 範圍 B — 補登 8/2–8/9 缺漏的固定支出（清潔費 + 洗攤）。
//
// ⚠️ 只能在容器內跑（DATABASE_URL 指向 /app/data/dev.db），紅線禁止從 host 用
// python sqlite3 之類工具寫入（2026-08-04 事故：host 寫入後連線關閉 checkpoint
// 掉 dev.db-wal/-shm，容器內 Prisma 握著已刪除的 handle → 全站 SqliteError 14）。
//
// 執行方式：
//   dry-run（預設，只印不寫）：docker exec market-ledger-bot npx tsx scripts/t-ml-027-backfill.ts
//   真的寫入：                 docker exec market-ledger-bot npx tsx scripts/t-ml-027-backfill.ts --apply
//
// 主控預估 30 筆 / NT$ 6,900（詳見 vault/ops/task-queue.md T-ML-027 spec），明確
// 排除 8/7 潮州（當時查證潮州 8/7 沒有營業額紀錄）。本腳本執行時重新唯讀查證發現
// 8/7 潮州營業額已經在 2026-08-09 當天被透過 Telegram bot 補打進來（見腳本輸出的
// 「⚠️ 額外發現」段落）—— 這是主控原始 30 筆估算之後才發生的新資料，不在批准範圍
// 內，本腳本刻意排除、只回報不自動補，交給 owner 決定。

import prisma from "../src/lib/prisma";
import { previewFixedExpenses, applyFixedExpenses, stallForLocation, realEntryDb } from "../src/lib/fixedExpenseAutofill";
import { utcDate } from "../src/lib/analytics/dateRange";

const TENANT_ID = "cml8xdpx20000cfyo23pu6cbm"; // 洪記軒正式企業（唯一有清潔費/洗攤 Dictionary 的租戶）

// 補登範圍：2026-08-02 ～ 2026-08-09（含）
const RANGE_START = utcDate(2026, 8, 2);
const RANGE_END = utcDate(2026, 8, 9); // inclusive

// 明確排除清單（自然鍵：YYYY-MM-DD + locationName）——8/7 潮州不在主控原始 30 筆
// 估算內，即使目前有營收也先不補，等 owner 看過 D 範圍調查結果再決定
const EXCLUDE: { dateKey: string; locationName: string }[] = [
    { dateKey: "2026-08-07", locationName: "潮州攤位" },
];

function dateKeyUTC(d: Date): string {
    return d.toISOString().slice(0, 10);
}

async function main() {
    const apply = process.argv.includes("--apply");

    const locations = await prisma.location.findMany({ where: { tenantId: TENANT_ID, isActive: true } });
    const days: Date[] = [];
    for (let d = RANGE_START; d.getTime() <= RANGE_END.getTime(); d = new Date(d.getTime() + 86400000)) {
        days.push(d);
    }

    type PlanRow = {
        dateKey: string;
        locationName: string;
        locationId: string;
        expenseLabel: string;
        expenseType: string;
        amount: number;
        alreadyExists: boolean;
        excluded: boolean;
    };
    const plan: PlanRow[] = [];
    const extraFindings: string[] = [];

    for (const loc of locations) {
        const stall = await stallForLocation(TENANT_ID, loc.id);
        if (!stall) continue; // 非屏東/潮州的地點跳過（目前租戶只有這兩個）

        for (const day of days) {
            const dateKey = dateKeyUTC(day);
            const revenue = await prisma.revenue.findFirst({ where: { tenantId: TENANT_ID, locationId: loc.id, date: day } });
            if (!revenue || revenue.isDayOff || !(revenue.amount > 0)) continue; // 沒營業額/公休 → 不該有固定支出

            const excluded = EXCLUDE.some((e) => e.dateKey === dateKey && e.locationName === loc.name);
            if (excluded) {
                extraFindings.push(
                    `${dateKey} ${loc.name} 有營業額 NT$${revenue.amount}（createdAt=${revenue.createdAt.toISOString()}），但不在主控原始 30 筆估算內，本次刻意跳過不補`
                );
            }

            const preview = await previewFixedExpenses(TENANT_ID, day, loc.id);
            if (!preview) continue;
            for (const item of preview.items) {
                plan.push({
                    dateKey,
                    locationName: loc.name,
                    locationId: loc.id,
                    expenseLabel: item.expenseLabel,
                    expenseType: item.expenseType,
                    amount: item.amount,
                    alreadyExists: item.alreadyExists,
                    excluded,
                });
            }
        }
    }

    const actionable = plan.filter((p) => !p.alreadyExists && !p.excluded);
    const totalAmount = actionable.reduce((s, p) => s + p.amount, 0);

    console.log(`\n=== T-ML-027 範圍 B 補登 dry-run（${apply ? "將實際寫入" : "僅預覽，不寫入"}） ===\n`);
    console.log("日期        攤位     項目    金額   狀態");
    for (const p of plan) {
        const status = p.excluded ? "排除（見下方額外發現）" : p.alreadyExists ? "已存在，略過" : "將補登";
        console.log(`${p.dateKey}  ${p.locationName}  ${p.expenseLabel}  NT$${p.amount}  ${status}`);
    }

    console.log(`\n--- 彙總（僅計「將補登」列） ---`);
    const byLabel = new Map<string, { count: number; amount: number }>();
    for (const p of actionable) {
        const key = `${p.locationName === "屏東攤位" ? "屏東" : "潮州"}${p.expenseLabel}`;
        const cur = byLabel.get(key) ?? { count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += p.amount;
        byLabel.set(key, cur);
    }
    for (const [label, v] of byLabel) {
        console.log(`${label}：${v.count} 筆 / NT$${v.amount}`);
    }
    console.log(`合計：${actionable.length} 筆 / NT$${totalAmount}`);
    console.log(`\n主控預估：30 筆 / NT$6,900 —— ${actionable.length === 30 && totalAmount === 6900 ? "✅ 完全對照" : "⚠️ 對不上，需要人工檢查（見上表）"}`);

    if (extraFindings.length > 0) {
        console.log(`\n=== ⚠️ 額外發現（不在批准範圍內，本次不補，回報 owner 決定） ===`);
        extraFindings.forEach((f) => console.log("- " + f));
    }

    if (!apply) {
        console.log(`\n(dry-run 模式，未寫入任何資料。確認上表無誤後加 --apply 才會真的寫入)`);
        return;
    }

    if (actionable.length !== 30 || totalAmount !== 6900) {
        console.log(`\n🛑 數字與主控預估不符，依紅線規則停止寫入，不自行調整。`);
        process.exitCode = 1;
        return;
    }

    // ── 寫入前備份（SQLite VACUUM INTO = 官方 backup API，WAL 模式下拿到一致快照，
    //    紅線明確禁止用 cp）──────────────────────────────────────────────
    const backupPath = `/app/data/dev.db.T-ML-027-BACKFILL-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backupPath}'`);
    console.log(`\n✅ 備份完成：${backupPath}`);

    console.log(`\n=== 開始寫入 ${actionable.length} 筆 ===`);
    let created = 0;
    let skipped = 0;
    for (const loc of locations) {
        const stall = await stallForLocation(TENANT_ID, loc.id);
        if (!stall) continue;
        for (const day of days) {
            const dateKey = dateKeyUTC(day);
            const rowsForThisDay = actionable.filter((p) => p.locationId === loc.id && p.dateKey === dateKey);
            if (rowsForThisDay.length === 0) continue;
            const items = rowsForThisDay.map((r) => ({ expenseType: r.expenseType, expenseLabel: r.expenseLabel as "清潔費" | "洗攤", amount: r.amount }));
            const result = await applyFixedExpenses(realEntryDb, TENANT_ID, day, stall, null, items);
            created += result.created.length;
            skipped += result.skipped.length;
            for (const c of result.created) console.log(`  + ${dateKey} ${loc.name} ${c.expenseLabel} $${c.amount}`);
            for (const s of result.skipped) console.log(`  · ${dateKey} ${loc.name} ${s.expenseLabel} 已存在，跳過`);
        }
    }
    console.log(`\n=== 完成：建立 ${created} 筆，跳過 ${skipped} 筆 ===`);
}

main()
    .catch((err) => {
        console.error("[t-ml-027-backfill] FATAL:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
