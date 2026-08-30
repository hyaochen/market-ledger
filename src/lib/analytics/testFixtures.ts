// 測試用共用常數 —— 不是 .test.ts，是給多個測試檔 import 的 fixture。
// REAL_TENANT_ID 是主控 8/4 稽核查明的「預設企業」真實租戶（vault/projects/
// market-ledger/reports/2026-07_expense-audit.md）。DEMO_TENANT_ID 是飲料展示
// 企業（7 個月示範數據），部分測試用來驗證 tenantId 隔離（不可查到彼此資料）。
//
// 所有吃這兩個常數的測試都只做 SELECT，不寫入/修改資料庫（T-ML-025 批 1 紅線）。

export const REAL_TENANT_ID = "cml8xdpx20000cfyo23pu6cbm";
export const DEMO_TENANT_ID = "cmm0w2ja40000c2v00yb2w46t";
