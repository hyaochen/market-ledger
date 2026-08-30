// 異常偵測 6 類的測試。除了案例 1 之外全部直接對真實 DB 跑唯讀查詢
// （docker-data/dev.db，tenantId 隔離），驗證真的抓得到主控 2026-08-04 / 08-07
// 稽核發現的髒資料。案例 1 因為當時的異常值已經被 owner 修正回正確金額
// （見 status.md 2026-08-04 段：7/31 屏東 50,000 → 9,595），現在的 DB 已經是乾淨的，
// 所以改用「真實背景分布（唯讀查出來）+ 情境重建注入」驗證演算法本身，細節見案例 1
// 測試內的說明註解。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findAmountOutliers,
    detectPurchasePriceOutliers,
    detectDateAnomalies,
    clusterNameVariants,
    detectNameVariants,
    detectStallNoteTypos,
    detectMissingFixedExpenses,
    detectAllAnomalies,
} from "./anomalies";
import { monthRangeUTC, resolveRange } from "./dateRange";
import prisma from "@/lib/prisma";
import { REAL_TENANT_ID, DEMO_TENANT_ID } from "./testFixtures";

// ── 案例 1：金額離群 ──────────────────────────────────────────────────

test("案例1 金額離群：真實 7 月屏東營業額背景分布 + 重建已修正的 50,000 異常值 → 演算法抓得到", async () => {
    // 唯讀查詢：抓真實 7 月屏東營業額背景分布（此刻已經是乾淨資料，不含當年的 50,000 誤植）
    const range = monthRangeUTC(2026, 7);
    const revenues = await prisma.revenue.findMany({
        where: { tenantId: REAL_TENANT_ID, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
        include: { location: true },
    });
    const pingtungRevenues = revenues.filter((r) => r.location?.name === "屏東攤位");
    assert.ok(pingtungRevenues.length >= 20, "背景樣本數太少，測試前提不成立");

    const points = pingtungRevenues.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        groupKey: r.locationId,
        groupLabel: "屏東攤位",
        amount: r.amount,
    }));
    // 情境重建：把當年真實發生過、後來被 owner 修正的 50,000 誤植值加進真實背景分布
    // （純記憶體操作，不寫 DB）。正解是 9,595（見 status.md），這裡刻意不用正解，
    // 用當時錯誤金額驗證偵測器抓得到「當時」那個真實案例。
    points.push({ id: "synthetic-2026-07-31-bug", date: "2026-07-31", groupKey: pingtungRevenues[0].locationId, groupLabel: "屏東攤位", amount: 50000 });

    const outliers = findAmountOutliers(points);
    const hit = outliers.find((o) => o.id === "synthetic-2026-07-31-bug");
    assert.ok(hit, "應該抓到重建的 50,000 異常值");
    assert.ok(Math.abs(hit!.robustZ) >= 3.5);
    assert.ok(hit!.ratioToMedian > 2, "50,000 應該遠高於中位數的兩倍以上");
});

test("案例1 金額離群：目前真實 DB 的 7/31 屏東營收（已修正為 9,595）不會被誤判為離群", async () => {
    const range = monthRangeUTC(2026, 7);
    const revenues = await prisma.revenue.findMany({
        where: { tenantId: REAL_TENANT_ID, date: { gte: range.gte, lt: range.lt }, isDayOff: false },
        include: { location: true },
    });
    const points = revenues.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        groupKey: r.locationId,
        groupLabel: r.location?.name ?? r.locationId,
        amount: r.amount,
    }));
    const outliers = findAmountOutliers(points);
    const july31 = points.find((p) => p.date === "2026-07-31" && p.groupLabel === "屏東攤位");
    assert.ok(july31, "7/31 屏東營收紀錄應該存在（已修正值 9,595）");
    assert.equal(july31!.amount, 9595, "確認資料庫目前是修正後的正確值，不是當年的 50,000");
    assert.ok(!outliers.some((o) => o.id === july31!.id), "修正後的 9,595 不該被判定為離群值");
});

// ── 案例 2：單價離群 ──────────────────────────────────────────────────

test("案例2 單價離群：真實 DB 7 月抓得到 7/11 五花肉 652/kg（同期 220-240）", async () => {
    const range = monthRangeUTC(2026, 7);
    const outliers = await detectPurchasePriceOutliers(REAL_TENANT_ID, range);
    const hit = outliers.find((o) => o.itemName === "五花肉" && o.date === "2026-07-11");
    assert.ok(hit, "應該抓到 7/11 五花肉單價離群");
    assert.ok(Math.abs(hit!.pricePerKg - 652.13) < 0.1);
    assert.ok(hit!.medianPricePerKg < 260, "同期其他日期單價應該在 220-240 附近，中位數不該被離群值拉走");
    assert.ok(Math.abs(hit!.robustZ) >= 3.5);
});

test("案例2 單價離群：tenantId 隔離 — demo 租戶查不到真實租戶的五花肉異常", async () => {
    const range = monthRangeUTC(2026, 7);
    const outliers = await detectPurchasePriceOutliers(DEMO_TENANT_ID, range);
    assert.ok(!outliers.some((o) => o.itemName === "五花肉"), "demo 租戶不應該有真實租戶的品項資料");
});

// ── 案例 3：日期不合理 ────────────────────────────────────────────────

test("案例3 日期異常：真實 DB 抓得到 2001 年的 Entry（PURCHASE + EXPENSE 都有）與 Revenue", async () => {
    const anomalies = await detectDateAnomalies(REAL_TENANT_ID);
    const entryHits = anomalies.filter((a) => a.source === "entry" && a.date.startsWith("2001"));
    const revenueHits = anomalies.filter((a) => a.source === "revenue" && a.date.startsWith("2001"));

    assert.ok(entryHits.length > 0, "應該抓到 2001 年的 Entry");
    assert.ok(revenueHits.length > 0, "應該抓到 2001 年的 Revenue（已知至少 1 筆 2001-06-18）");

    // spec 舉例點名的兩個 expenseType（EXP017、EXP021）至少要在抓到的清單裡
    const expenseTypes = entryHits.filter((e) => e.type === "EXPENSE");
    assert.ok(expenseTypes.length >= 2, "2001 年的 EXPENSE 筆數應該 >= spec 點名的 2 筆");
});

test("案例3 日期異常：正常年份（2026）的紀錄不會被誤判", async () => {
    const anomalies = await detectDateAnomalies(REAL_TENANT_ID);
    assert.ok(!anomalies.some((a) => a.date.startsWith("2026")), "2026 年資料是正常資料，不該出現在異常清單");
});

// ── 案例 4：同人多寫法 ────────────────────────────────────────────────

test("clusterNameVariants（純函式）：containment 聚類 + 依出現次數建議 canonical", () => {
    const clusters = clusterNameVariants([
        { note: "阿菊", count: 5, totalAmount: 65000 },
        { note: "阿菊廚房", count: 1, totalAmount: 9000 },
        { note: "麗玉", count: 1, totalAmount: 3000 }, // 不該被拉進任何 cluster
    ]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].suggestedCanonical, "阿菊", "出現次數較多的寫法應該被建議為正確拼法");
    assert.equal(clusters[0].variants.length, 2);
});

test("clusterNameVariants（純函式）: 不同 expenseType 的字串不會透過共同子字串誤橋接（踩坑迴歸測試）", () => {
    // 這是批 1 開發中真的踩到的 bug：「廚房」單獨一筆（來自另一個支出類型）
    // 透過 containment 把「阿菊廚房」「莉莉廚房」串成同一群，導致「阿菊」「莉莉」
    // 被誤判成同一人。修法是呼叫端（detectNameVariants）先依 expenseType 分桶，
    // clusterNameVariants 本身只保證「同一批輸入內」正確 clustering —— 這裡直接
    // 用只含同一 expenseType 資料的輸入驗證阿菊/莉莉不會被彼此污染。
    const clusters = clusterNameVariants([
        { note: "阿菊", count: 5, totalAmount: 65000 },
        { note: "阿菊廚房", count: 1, totalAmount: 9000 },
        { note: "莉莉", count: 1, totalAmount: 1000 },
        { note: "莉莉廚房", count: 1, totalAmount: 1000 },
    ]);
    assert.equal(clusters.length, 2, "應該是兩個獨立 cluster（阿菊系 / 莉莉系），不是合併成一個");
    const covers = (c: (typeof clusters)[number], note: string) => c.variants.some((v) => v.note === note);
    const juCluster = clusters.find((c) => covers(c, "阿菊"));
    const liCluster = clusters.find((c) => covers(c, "莉莉"));
    assert.ok(juCluster && !covers(juCluster, "莉莉") && !covers(juCluster, "莉莉廚房"));
    assert.ok(liCluster && !covers(liCluster, "阿菊") && !covers(liCluster, "阿菊廚房"));
});

test("案例4 真實 DB：抓得到薪資備註的三組已知變體（阿菊/莉莉/黃曜曟系列），且彼此不互相污染", async () => {
    const range = resolveRange("2026-01-01", "2026-12-31");
    const clusters = await detectNameVariants(REAL_TENANT_ID, range);
    const salaryClusters = clusters.filter((c) => c.expenseLabel === "薪資");

    const findCluster = (note: string) => salaryClusters.find((c) => c.variants.some((v) => v.note === note));

    const ju = findCluster("阿菊");
    assert.ok(ju, "應該抓到阿菊 cluster");
    assert.ok(ju!.variants.some((v) => v.note === "阿菊廚房"));

    const li = findCluster("莉莉");
    assert.ok(li, "應該抓到莉莉 cluster");
    assert.ok(li!.variants.some((v) => v.note === "莉莉廚房"));

    const huang = findCluster("黃曜曟") ?? findCluster("曜曟");
    assert.ok(huang, "應該抓到黃曜曟/曜曟 cluster");
    assert.ok(huang!.variants.some((v) => v.note === "黃曜曟") && huang!.variants.some((v) => v.note === "曜曟"));

    // 迴歸驗證：阿菊那組不該混進莉莉的變體，反之亦然（修過的 bug 不能再犯）
    assert.ok(!ju!.variants.some((v) => v.note.includes("莉莉")));
    assert.ok(!li!.variants.some((v) => v.note.includes("阿菊")));

    // 廖建華/廖建豪已經被 owner 統一寫法，現在不該再被抓成一組雙寫法 cluster
    const liao = findCluster("廖建華");
    if (liao) {
        assert.ok(!liao.variants.some((v) => v.note === "廖建豪"), "廖建豪已統一，不該再出現");
    }
});

// ── 案例 5：攤位備註不在已知清單 ──────────────────────────────────────

test("案例5 攤位備註錯字：真實 DB 抓得到 7/20 洗攤備註「終身」", async () => {
    const range = resolveRange("2026-07-01", "2026-07-31");
    const hits = await detectStallNoteTypos(REAL_TENANT_ID, range);
    const hit = hits.find((h) => h.date === "2026-07-20" && h.note === "終身");
    assert.ok(hit, "應該抓到 7/20 「終身」這筆");
    assert.equal(hit!.inferredStall, "pingtung");
    assert.equal(hit!.matchedAlias, "終身");
});

test("案例5 攤位備註錯字：乾淨寫法（中山/潮州本身）不會被誤判為錯字", async () => {
    const range = resolveRange("2026-07-01", "2026-07-31");
    const hits = await detectStallNoteTypos(REAL_TENANT_ID, range);
    assert.ok(!hits.some((h) => h.note === "中山" || h.note === "潮州"), "乾淨寫法不該出現在錯字清單");
});

// ── 案例 6：固定支出缺漏 ──────────────────────────────────────────────

test("案例6 固定支出缺漏：7 月已補齊區間（7/1-7/30）符合星期規則，缺口為 0", async () => {
    // 主控 2026-08-04 稽核已將 7 月固定支出補齊（79 筆），逐日驗證 7/1-7/30 全對齊。
    // 稽核報告文字提到「7/2 清點表記 220（規則應 110）」，但唯讀查證後那是 CashCount
    // 清點 PWA 原始表（expensesJson）上的數字，不是這裡查的 Entry 表 —— Entry 表裡
    // 7/2 屏東清潔費實際值是 110，跟規則一致（已用 $queryRaw 級別直接核對過）。
    // 所以這裡預期 7/1-7/30 完全零缺口，不留假的例外容錯。
    const range = resolveRange("2026-07-01", "2026-07-30");
    const missing = await detectMissingFixedExpenses(REAL_TENANT_ID, range);
    assert.deepEqual(missing, [], `7/1-7/30 應該零缺口：${JSON.stringify(missing)}`);
});

test("案例6 固定支出缺漏：7 月全月（含 7/31）現已零缺口", async () => {
    // 沿革：批 1 開發時用偵測器實跑，發現 7/31 屏東有營業額（9,595）卻整天沒有
    // 清潔費也沒有洗攤 —— 那天不在主控 8/4 稽核報告的逐日表格內（表格只到 7/30）。
    // 當時這個測試斷言「7/31 屏東缺 2 筆」，等於把一個**待修的缺陷狀態**寫死成
    // 預期值。2026-08-09 T-ML-028 依 owner 指示補登後（7/31 屏東 220+300、
    // 7/31 潮州 220+250），這個斷言必然失效 —— 主控 spot-check 時親跑測試抓到。
    //
    // 🔴 教訓（跟 stallProfit.test.ts 那條同一類）：不要把「目前資料剛好長這樣」
    // 當斷言，尤其當那個「這樣」本身就是等著被修掉的缺漏。改成驗證修完後應該
    // 恆成立的性質 —— 全月零缺口 —— 這在未來再補登或調規則之後依然說得通。
    const range = monthRangeUTC(2026, 7);
    const missing = await detectMissingFixedExpenses(REAL_TENANT_ID, range);
    assert.deepEqual(missing, [], `7 月全月應零缺口（含 7/31）：${JSON.stringify(missing)}`);
});

test("案例6 固定支出缺漏：2026-03~06（T-ML-029 第 2 層）補登後，status='missing' 的真缺口應為 0（06-18 已知例外除外）", async () => {
    // T-ML-029（2026-08-09）依 owner「①照規則補」批准，把 2026-03-01~06-30 這段
    // 91 筆「有營業額但缺清潔費/洗攤」的真缺口全部補齊。這裡驗證的是「真的缺
    // （status='missing'，actualAmount=null）」這個子集合是否清零——不驗證
    // status='amount_mismatch' 的筆數，因為那反映的是完全不同的另一件事：
    //
    // 🔴 重要發現（T-ML-029 過程中查證，超出本次補登範圍）：expectedWashFee()
    // （fixedExpenseRules.ts）目前寫死屏東洗攤=300 不分日期，但唯讀查證真實歷史
    // 資料後發現屏東洗攤的漲價過程**不是乾淨的 4/1 一刀切**——3 月全月穩定 250、
    // 4/1~5/1 期間 250/300 混雜出現（推測是漲價公告後執行不一致），直到 5/2 起
    // 才穩定變成 300。這代表 detectMissingFixedExpenses() 對 3~4 月甚至部分 5 月
    // 初的「既有」（本次補登範圍之外的）屏東洗攤紀錄，本來就會回報大量
    // amount_mismatch（不是本次任務造成，補登前就存在），把這個數字斷言成 0
    // 會是假的（且會在漲價規則之後被誰改動時產生誤導性的綠燈）。真正該鎖住的
    // 性質是「沒有真缺口」，僅此而已。詳見 vault 報告
    // reports/2026-08-09_layer2-estimated-backfill.md「規則來源」段。
    //
    // 06-18 屏東清潔費是已知例外：Entry note="中"（單字，不在 stallInference.ts
    // 的別名清單內）金額 110 恰好吻合當天星期規則，本次補登腳本已唯讀查證後刻意
    // 不重複寫入（見 scripts/t-ml-029-backfill.ts 的 KNOWN_EXISTING_EXCEPTIONS 說明），
    // 但這也代表 detectMissingFixedExpenses() 仍會誤報這天「缺清潔費」——這是
    // inferStallFromNote() 別名清單的既有限制，不是本次任務造成、也不是本次任務
    // 範圍要修的，如實記錄在這裡讓這個已知例外不會被誤判成回歸。
    const months = [3, 4, 5, 6];
    for (const month of months) {
        const range = monthRangeUTC(2026, month);
        const missing = await detectMissingFixedExpenses(REAL_TENANT_ID, range);
        const trueGaps = missing.filter((m) => m.status === "missing");
        if (month === 6) {
            assert.equal(trueGaps.length, 1, `2026-06 應該只剩 1 個已知例外：${JSON.stringify(trueGaps)}`);
            assert.equal(trueGaps[0].date, "2026-06-18");
            assert.equal(trueGaps[0].stall, "pingtung");
            assert.equal(trueGaps[0].expenseLabel, "清潔費");
        } else {
            assert.deepEqual(trueGaps, [], `2026-${month} 應該零真缺口（status='missing'）：${JSON.stringify(trueGaps)}`);
        }
    }
});

test("案例6 固定支出缺漏：demo 租戶沒有設清潔費/洗攤字典 → 回空陣列而非丟錯", async () => {
    const range = monthRangeUTC(2026, 3);
    const missing = await detectMissingFixedExpenses(DEMO_TENANT_ID, range);
    assert.deepEqual(missing, []);
});

// ── 彙總入口 ──────────────────────────────────────────────────────────

test("detectAllAnomalies: 彙總入口回傳完整 6 類 + summary 計數，且不跨租戶洩漏", async () => {
    const result = await detectAllAnomalies(REAL_TENANT_ID, "2026-07-01", "2026-07-31");
    assert.ok(result.summary.priceOutliers >= 1);
    assert.ok(result.summary.stallNoteTypos >= 1);
    assert.equal(typeof result.summary.dateAnomalies, "number");

    const demoResult = await detectAllAnomalies(DEMO_TENANT_ID, "2026-07-01", "2026-07-31");
    assert.ok(!demoResult.priceOutliers.some((p) => p.itemName === "五花肉"));
});
