# 進貨存管系統

專為手機與平板操作設計的進貨、支出與營收管理系統，支援公斤/臺斤換算、多廠商記錄與報表分析。

## 核心特色

- Mobile First 介面，適合攤商快速操作
- 單位換算：公斤/臺斤與捆、袋、籃等單位
- 進貨/支出/營收三合一紀錄
- 報表分析與可編輯查詢
- 可部署到本機、區網或雲端

## 技術規格

- UI Framework: Next.js (App Router)
- Styling: Tailwind CSS + Shadcn/UI
- Database: SQLite (本地) / PostgreSQL (雲端)
- ORM: Prisma

## 快速開始

### 1. 安裝與初始化

```bash
npm install
npx prisma db push
npx prisma db seed
```

### 2. 啟動開發伺服器

```bash
npm run dev
```

開啟瀏覽器訪問 `http://localhost:3000`。

## 使用說明

### 登入與權限
- 預設唯讀帳號：`viewer / viewer123`
- 預設管理者帳號：`admin / admin123`
- 權限等級：讀取 < 編輯 < 管理（高權限包含低權限）
- 只有管理者可進入「設定」模組

### 新增進貨/支出
1. 點擊底部「記帳」。
2. 選擇「進貨」或「其他支出」。
3. 進貨：先選類別、品項、廠商，再輸入數量與金額。
4. 支出：選擇項目並填入金額。

### 查看營收
進入「營收」頁面記錄每日兩個攤位的營業額；未填金額即視為休假。

### 報表與匯出
進入「報表」頁面選擇日期區間，可檢視統計並匯出 CSV（Excel 可直接開啟）。

## 區網使用 (手機/平板連線)

1. 允許外部連線啟動：
```bash
npm run dev:lan
```
2. 找出主機 IP (例如 192.168.1.20)。
3. 手機開啟 `http://192.168.1.20:3000`。
4. 若無法連線，請確認防火牆已允許 Node/Next.js 通過。

## 資料備份 (建議週期)

版本保存策略：
- 近 14 天：每日備份
- 近 8 週：每週保留 1 份
- 近 12 個月：每月保留 1 份

執行備份：
```bash
npm run backup:db
```

可用 Windows 工作排程器 (Task Scheduler) 設定每天自動執行。
備份檔會存放在 `backups/` 目錄。

## 部署指南

1. Build 專案：
```bash
npm run build
```
2. 啟動服務：
```bash
npm run start
```
3. 若需區網部署：
```bash
npm run start:lan
```

雲端部署建議使用 Vercel、Render 或自架伺服器，並將 `DATABASE_URL` 指向雲端資料庫。

請設定 `SESSION_SECRET` 環境變數以保護登入 Session。

## 安全性

- 內建帳號登入與角色權限控管 (read/write/admin)
- Prisma ORM 可避免常見 SQL Injection
- 上線環境務必設定 `SESSION_SECRET`
