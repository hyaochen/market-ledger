# Analytics 模組 — API 契約（T-ML-025 批 1）

給批 2（bot 問答接入）與批 3（網頁分析頁面）接手用。這份文件是**契約**，欄位名稱/型別異動要同步更新本檔。

## 目錄結構

```
src/lib/analytics/
  dateRange.ts        日期範圍工具（全部 UTC 基準，見下方「日期陷阱」）
  stallInference.ts    攤位備註推斷（中山/潮州 + 已知錯字變體）
  priceNormalize.ts    單位換算成 元/kg
  textMatch.ts          輕量 fuzzy 比對（跟 bot/matcher.ts 獨立，無依賴關係）
  stats.ts              中位數/MAD/穩健 z-score
  itemResolve.ts        品項名稱→Item[] 模糊解析
  itemSearch.ts          需求1
  vendorCompare.ts       需求2
  noteSearch.ts           需求3
  priceTrend.ts           需求4
  stallProfit.ts          需求5
  periodCompare.ts        需求6
  anomalies.ts             需求7（6 個子偵測器 + 彙總 detectAllAnomalies）
  classifyPurchase.ts      需求8
  classifyExpense.ts       需求9
  classifyStall.ts         需求10
  index.ts                  barrel export（全部 re-export，可 `import { X } from '@/lib/analytics'`）
```

所有函式都是純 async function，直接 `import prisma from '@/lib/prisma'`（不用 DI），**每個函式第一個必要參數都是 `tenantId: string`**，呼叫端（API route / bot / 網頁 server action）自己負責從 session 拿到 tenantId 再傳進來 — 這幾支函式本身完全不管 auth/session。

## 🔴 日期陷阱（批 2/3 一定要讀）

`Entry.date` / `Revenue.date` 存進 DB 的是「該筆記錄所屬營業日的 **UTC 午夜**」epoch ms（已用 `$queryRawUnsafe` 直接驗證過）。這是因為寫入路徑跑在 Docker 容器（TZ=UTC），`new Date(y,m-1,d)` 在容器裡剛好等於 UTC 午夜。

如果批 2/3 要自己組日期查詢條件（不是呼叫這裡現成的函式），**禁止用 `new Date(y, m-1, d)`**（local 建構子）—— host 開發機通常是 Asia/Taipei（UTC+8），會算出比資料庫實際存的值早/晚 8 小時，導致範圍查詢對不上一整批資料且不容易發現（不是差一天，是差 8 小時，很多時候剛好還是查得到大部分資料，只有邊界那幾筆會漏，非常隱蔽）。

一律用 `dateRange.ts` 提供的 `utcDate()` / `resolveRange()` / `monthRangeUTC()` 等函式，或至少用 `Date.UTC(...)`。

## 🔴 攤位判斷的本質限制（批 2/3 設計 UI/bot 對話時要知道）

`Entry`（進貨/支出）沒有 `locationId`，攤位只能靠 `note` 字串猜（`stallInference.ts`）。實測：

- **進貨（PURCHASE）幾乎 0% 可判斷**：全租戶目前只有 3 筆進貨有備註，沒有一筆對得到「中山/潮州」。`classifyStall()` 對進貨幾乎必然回 `unknown`。
- **支出（EXPENSE）好很多**：清潔費/洗攤/水電費這幾類支出的備註習慣本來就會寫攤位，可歸屬率約 43%（7 月實測；租金/薪資/雜項大多沒寫攤位）。

批 2（bot）如果要用 `classifyStall()` 幫使用者省輸入，**進貨對話流程還是要照舊問使用者攤位**，不要指望這支函式能自動判斷進貨的攤位。

---

## 需求對照表

| # | 需求 | 函式 | API route |
|---|------|------|-----------|
| 1 | 品項關鍵字搜尋 | `searchItemPurchases()` | `GET /api/analytics/search/items` |
| 2 | 廠商比價 | `compareVendorPrices()` | `GET /api/analytics/vendor-compare` |
| 3 | 備註全文搜尋 | `searchNotes()` | `GET /api/analytics/search/notes` |
| 4 | 品項價格趨勢 | `getItemPriceTrend()` | `GET /api/analytics/price-trend` |
| 5 | 攤位損益對比 | `getStallProfitComparison()` | `GET /api/analytics/stall-profit` |
| 6 | 月環比/去年同期 | `getPeriodComparison()` | `GET /api/analytics/period-compare` |
| 7 | 異常偵測 | `detectAllAnomalies()`（+ 6 個獨立子函式） | `GET /api/analytics/anomalies` |
| 8 | 進貨自動歸類 | `classifyPurchaseCategory()` | `GET /api/analytics/classify/purchase` |
| 9 | 支出自動分類 | `classifyExpenseType()` | `GET /api/analytics/classify/expense` |
| 10 | 攤位自動判斷 | `classifyStall()` | `GET /api/analytics/classify/stall` |

所有 API route 都要求先登入（`getCurrentUser()`），未登入回 `401 { error: string }`；查詢/分類失敗回 `500 { error: string }`；缺必要參數回 `400 { error: string }`。**Response 一律 JSON**，成功時直接是對應函式的回傳型別（見下方逐項說明），沒有額外包一層 `{ data: ... }`。

---

## 需求 1：品項關鍵字搜尋 — `searchItemPurchases()`

```ts
function searchItemPurchases(params: {
  tenantId: string;
  query?: string;      // 品項名稱關鍵字（模糊比對），跟 itemId 擇一給
  itemId?: string;      // 直接指定 Item.id，略過模糊比對
  from?: string | null; // 'YYYY-MM-DD'，預設回溯 90 天
  to?: string | null;
}): Promise<{
  range: { from: string; to: string };
  matchedItems: { id: string; name: string; score: number }[];
  rows: {
    entryId: string; date: string; itemId: string; itemName: string;
    vendorId: string | null; vendorName: string | null;
    inputQuantity: number | null; inputUnit: string | null;
    totalPrice: number; unitPrice: number | null;
    pricePerKg: number | null;   // 換算基準，個數單位品項會是 null
    note: string | null;
  }[];
  summary: { count: number; totalQuantityKg: number; totalPrice: number; avgPricePerKg: number | null };
}>
```

`GET /api/analytics/search/items?q=五花&from=2026-07-01&to=2026-07-31`

## 需求 2：廠商比價 — `compareVendorPrices()`

```ts
function compareVendorPrices(params: {
  tenantId: string; query?: string; itemId?: string; from?: string | null; to?: string | null;
}): Promise<{
  range: { from: string; to: string };
  matchedItems: { id: string; name: string; score: number }[];
  vendors: {           // 由便宜到貴排序（依 avgPricePerKg）
    vendorId: string; vendorName: string; count: number;
    avgPricePerKg: number; minPricePerKg: number; maxPricePerKg: number;
    latestPricePerKg: number; latestDate: string;
    points: { date: string; pricePerKg: number; totalPrice: number; kgWeight: number; entryId: string }[];
  }[];
  excludedNonWeightCount: number; // 因為單位無法換算成 kg 被排除的筆數（例如純個數單位）
  cheapestVendorId: string | null;
  priceSpreadPct: number | null; // 最貴 vs 最便宜的價差百分比
}>
```

`GET /api/analytics/vendor-compare?q=五花肉&from=2026-07-01&to=2026-07-31`

## 需求 3：備註全文搜尋 — `searchNotes()`

```ts
function searchNotes(params: {
  tenantId: string; query: string; from?: string | null; to?: string | null;
  source?: 'entry' | 'revenue' | 'both'; // 預設 'both'
}): Promise<{
  range: { from: string; to: string };
  query: string;
  hits: {
    source: 'entry' | 'revenue'; id: string; date: string; note: string; amount: number;
    context: string; // 例如「進貨：五花肉」「支出：洗攤」「營業額：屏東攤位」
  }[]; // 依日期新到舊排序
}>
```

`GET /api/analytics/search/notes?q=終身&from=2026-07-01&to=2026-07-31&source=entry`（`q` 必填，缺少回 400）

## 需求 4：品項價格趨勢 — `getItemPriceTrend()`

```ts
function getItemPriceTrend(params: {
  tenantId: string; query?: string; itemId?: string; from?: string | null; to?: string | null; // 預設回溯 365 天
}): Promise<{
  range: { from: string; to: string };
  matchedItems: { id: string; name: string; score: number }[];
  months: {
    month: string; // 'YYYY-MM'
    count: number; avgPricePerKg: number; minPricePerKg: number; maxPricePerKg: number;
    momChangePct: number | null; // 第一個有資料的月份是 null
  }[]; // 依月份由舊到新排序
  biggestJump: { month: string; momChangePct: number } | null; // 區間內單月最大漲幅
  excludedNonWeightCount: number;
}>
```

`GET /api/analytics/price-trend?q=五花肉&from=2026-01-01&to=2026-12-31`

## 需求 5：攤位損益對比 — `getStallProfitComparison()`

```ts
function getStallProfitComparison(params: {
  tenantId: string; from?: string | null; to?: string | null; // 預設回溯 30 天
  minConfidence?: number; // stallInference 信心度門檻，預設 0.75（含已知錯字變體）
}): Promise<{
  range: { from: string; to: string };
  byStall: {
    stall: 'pingtung' | 'chaozhou'; label: string;
    revenue: number; revenueDays: number;
    attributedExpense: number; attributedPurchase: number; // 只有備註可信對應到攤位的部分
    netAttributed: number; // revenue - attributedExpense - attributedPurchase，⚠️ 不是完整攤位損益
  }[];
  shared: {
    unattributedExpense: number; unattributedExpenseCount: number;
    unattributedPurchase: number; unattributedPurchaseCount: number;
    totalShared: number;
  };
  totals: { revenue: number; expense: number; purchase: number; combinedProfit: number }; // 全店整體損益，可信
  coverage: { expenseAttributionRate: number; purchaseAttributionRate: number }; // 0~1
  caveat: string; // 固定文字，說明限制，UI 應該原樣顯示給使用者看
}>
```

`GET /api/analytics/stall-profit?from=2026-07-01&to=2026-07-31`

**批 3 畫圖時**：`byStall[].netAttributed` 千萬不要當成「該攤位完整損益」直接畫成好看的損益長條圖，會誤導 owner。要嘛連 `caveat` 一起顯示，要嘛只畫 `totals.combinedProfit`（全店，不分攤位）。

## 需求 6：月環比 / 去年同期 — `getPeriodComparison()`

```ts
function getPeriodComparison(params: {
  tenantId: string; month?: string; // 'YYYY-MM'，預設本月
}): Promise<{
  current: PeriodMetrics;
  mom: { previous: PeriodMetrics; delta: DeltaBlock } | null;
  yoy: { previous: PeriodMetrics; delta: DeltaBlock } | null; // 2026 年目前一定是 null（見下）
  yoyReason: string | null; // yoy 為 null 時一定有值，UI 應顯示這句話而不是留白
}>

interface PeriodMetrics {
  month: string;
  revenueTotal: number; revenueByStall: { pingtung: number; chaozhou: number };
  purchaseTotal: number; expenseTotal: number; // expenseTotal 不含進貨
  expenseByCategory: { key: string; label: string; amount: number; count: number }[];
  totalCost: number; // purchaseTotal + expenseTotal
  profit: number;    // revenueTotal - totalCost
}
interface DeltaBlock {
  revenueDeltaPct: number | null; totalCostDeltaPct: number | null; profitDelta: number | null;
}
```

`GET /api/analytics/period-compare?month=2026-07`

**🔴 資料庫最早資料是 2026-01**（少數 2001 年是異常值，已被案例 3 偵測器排除），所以 2026 年任何月份的 YoY 目前都會是 `yoy: null`。批 2/3 UI 要處理這個狀態（顯示「無去年同期資料」而不是崩潰或顯示 0%）。

## 需求 7：異常偵測 — `detectAllAnomalies()` + 6 個子偵測器

```ts
function detectAllAnomalies(tenantId: string, from?: string | null, to?: string | null): Promise<{
  range: { from: string; to: string };
  amountOutliers: AmountOutlier[];        // 案例1：營收金額離群（同攤位比較）
  priceOutliers: PriceOutlier[];          // 案例2：進貨單價離群（同品項比較）
  dateAnomalies: DateAnomaly[];           // 案例3：日期不合理（絕對值判斷，不受 from/to 篩選）
  nameVariants: NameVariantCluster[];     // 案例4：同人多寫法（依 expenseType 分桶後聚類）
  stallNoteTypos: StallNoteTypo[];        // 案例5：攤位備註命中已知錯字變體
  missingFixedExpenses: MissingFixedExpense[]; // 案例6：清潔費/洗攤缺漏或金額不符規則
  summary: Record<string, number>; // 6 類各自的筆數
}>
```

6 個子偵測器都可以獨立呼叫（`detectRevenueAmountOutliers` / `detectPurchasePriceOutliers` / `detectDateAnomalies` / `detectNameVariants` / `detectStallNoteTypos` / `detectMissingFixedExpenses`），簽名細節見 `anomalies.ts` 內的 TSDoc 註解，這裡不重複列，只列彙總入口。

`GET /api/analytics/anomalies?from=2026-07-01&to=2026-07-31`

**案例3（日期異常）刻意不吃 `from`/`to`**：日期本身就是錯的資料，用查詢區間去篩選反而可能篩掉異常本身（例如查 2026 年範圍會漏掉 2001 年的髒資料）。`detectAllAnomalies()` 內部固定對全租戶掃描。

**案例6（固定支出）規則寫死在 `anomalies.ts` 的 `expectedCleaningFee()` / `expectedWashFee()`**：屏東清潔費週一/三/五=220、週二/四/六/日=110，洗攤 300；潮州清潔費 220、洗攤 250 —— 這是 owner 2026-08-04 提供的規則。**如果 owner 之後改規則（例如漲清潔費），這兩個函式要跟著改**，不是資料庫設定，是寫死的商業規則。

## 需求 8：進貨自動歸類 — `classifyPurchaseCategory()`

```ts
function classifyPurchaseCategory(tenantId: string, itemName: string): Promise<{
  categoryId: string | null; categoryName: string | null; confidence: number;
  method: 'exact-catalog' | 'fuzzy-catalog' | 'char-affinity' | 'unknown';
  candidates: { categoryId: string; categoryName: string; score: number }[];
}>
```

`GET /api/analytics/classify/purchase?name=五花肉片`（`name` 必填）

## 需求 9：支出自動分類 — `classifyExpenseType()`

```ts
function classifyExpenseType(tenantId: string, text: string): Promise<{
  value: string | null; label: string | null; confidence: number;
  method: 'exact' | 'fuzzy' | 'unknown';
  candidates: { value: string; label: string; score: number }[];
}>
```

`GET /api/analytics/classify/expense?text=瓦斯費`（`text` 必填）。回傳的 `value` 就是 `Entry.expenseType` 該存的值，`label` 是給人看的中文。

## 需求 10：攤位自動判斷 — `classifyStall()`

```ts
function classifyStall(input: {
  tenantId: string; note?: string | null; vendorId?: string | null; itemId?: string | null;
  excludeEntryId?: string; // 重新分類既有 Entry 時傳自己的 id，避免拿自己當歷史證據
}): Promise<{
  stall: 'pingtung' | 'chaozhou' | 'unknown';
  confidence: number; // 0~1，unknown 一定是 0
  method: 'note-alias' | 'note-typo-alias' | 'vendor-history' | 'item-history' | 'insufficient-data';
  detail: string; // 人類可讀的判斷依據說明，可以直接顯示給使用者
}>
```

`GET /api/analytics/classify/stall?note=中山`（三個輸入都選填，全空時必然回 `unknown`）

---

## 給批 2（bot）的建議

- Bot 回答「XX 品項最近漲了多少」→ 直接用 `getItemPriceTrend()`，看 `biggestJump`。
- Bot 回答「哪家廠商比較便宜」→ `compareVendorPrices()`，取 `vendors[0]`（已排序最便宜）。
- Bot 記帳流程要幫使用者判斷支出類型 → `classifyExpenseType()`，`confidence >= 0.85` 才自動帶入，否則照舊詢問使用者（沿用 bot 現有「信心度判斷」風格，門檻可以跟 `bot/matcher.ts` 現有邏輯對齊，兩邊目前都是獨立實作，之後要合併看批 2 的判斷）。
- **不要**用 `classifyStall()` 自動幫進貨（PURCHASE）填攤位 —— 上面講過，進貨幾乎必然 `unknown`，硬套只會讓使用者更困惑。

## 給批 3（網頁分析頁面 + Recharts）的建議

- `priceTrend.months` 可以直接餵 Recharts `LineChart`（`month` 當 X 軸、`avgPricePerKg` 當 Y 軸）。
- `stallProfit` 畫圖務必把 `shared` 那塊也畫出來（例如疊加長條圖多一段「共同成本，未分攤」），不要只畫 `byStall` 讓使用者誤以為攤位損益是完整的。
- `anomalies` 建議做成一個「稽核儀表板」頁面，6 類分頁籤或分區塊列出，`summary` 可以做成頂部計數卡片。
- 所有查詢都需要 `from`/`to`，UI 記得給合理預設值（搜尋類 90 天、趨勢類 365 天、損益/月比類當月），跟本模組函式的預設值保持一致，避免使用者以為「查全部」結果卻只查了 30 天。
