# 進貨存管系統

多租戶進銷存與營收管理平台，專為餐飲、零售、攤商設計。支援多企業隔離、行動裝置原生體驗，可透過 Cloudflare Tunnel 公開存取。

---

## 技術架構

| 層次 | 技術 |
|------|------|
| 前端框架 | Next.js 16 (App Router) + React 19 |
| 樣式 | Tailwind CSS v3 + Radix UI (shadcn/ui) |
| 資料庫 | SQLite（本機）via Prisma 5.22 |
| 認證 | HMAC-SHA256 簽名 Cookie Session |
| 部署 | Docker Compose + Cloudflare Tunnel |
| 圖表 | Recharts |

---

## 系統架構圖

```mermaid
graph TB
    subgraph 使用者端
        iPhone[iPhone / Android 瀏覽器]
        Desktop[桌面瀏覽器]
    end

    subgraph Cloudflare
        CF[Cloudflare Tunnel]
    end

    subgraph Docker Host
        direction TB
        Tunnel[cloudflared 容器]
        App[market-ledger 容器\nNext.js 16 + Node.js]
        DB[(SQLite\ndocker-data/dev.db)]
        Backup[(本機備份\nC:\\db-backups\\t_web)]
    end

    iPhone -->|HTTPS| CF
    Desktop -->|HTTPS| CF
    CF --> Tunnel
    Tunnel -->|http://localhost:3000| App
    App --> DB
    App -->|啟動時備份| Backup
```

---

## 多租戶架構

每個企業（Tenant）的資料完全隔離：所有業務資料表均含 `tenantId` 欄位，查詢時強制過濾。

```mermaid
graph LR
    subgraph 超級管理者
        SA[super admin\nisSuperAdmin=true\ntenantId=null]
    end

    subgraph 企業A
        AdminA[admin A]
        UserA[user A]
        DataA[(企業A資料\ntenantId=A)]
    end

    subgraph 企業B
        AdminB[admin B]
        UserB[user B]
        DataB[(企業B資料\ntenantId=B)]
    end

    SA -->|管理| 企業A
    SA -->|管理| 企業B
    SA -->|進入企業\n切換session| DataA
    SA -->|進入企業\n切換session| DataB
    AdminA --> DataA
    UserA --> DataA
    AdminB --> DataB
    UserB --> DataB
    DataA -. 完全隔離 .- DataB
```

---

## 認證流程

```mermaid
sequenceDiagram
    actor 使用者
    participant 瀏覽器
    participant Next.js
    participant Prisma
    participant Session

    使用者->>瀏覽器: 輸入帳號密碼
    瀏覽器->>Next.js: POST /login (Server Action)
    Next.js->>Prisma: 查詢 User (username + SHA256密碼)
    Prisma-->>Next.js: User { id, tenantId, isSuperAdmin }
    Next.js->>Session: 建立 HMAC-SHA256 簽名 Cookie
    Note over Session: { userId, tenantId, isSuperAdmin }
    Session-->>瀏覽器: Set-Cookie: session=...

    alt 超級管理者
        Next.js-->>瀏覽器: redirect /super-admin
    else 一般使用者
        Next.js-->>瀏覽器: redirect /
    end

    使用者->>瀏覽器: 存取受保護頁面
    瀏覽器->>Next.js: GET / (帶 Cookie)
    Next.js->>Session: 驗證 HMAC 簽名
    Session-->>Next.js: payload { userId, tenantId }
    Next.js->>Prisma: 查詢 User + Tenant 狀態
    Prisma-->>Next.js: 用戶資料
    Next.js-->>使用者: 渲染頁面
```

---

## 資料庫 ER 圖（核心模型）

```mermaid
erDiagram
    Tenant {
        string id PK
        string name
        string code UK
        boolean status
    }
    User {
        string id PK
        string username
        string password
        boolean isSuperAdmin
        string tenantId FK
    }
    Entry {
        string id PK
        date date
        string type "PURCHASE or EXPENSE"
        string status "PENDING or APPROVED"
        number totalPrice
        string tenantId FK
        string itemId FK
        string vendorId FK
    }
    Revenue {
        string id PK
        date date
        number amount
        boolean isDayOff
        string tenantId FK
        string locationId FK
    }
    Item {
        string id PK
        string name
        string defaultUnit
        string tenantId FK
        string categoryId FK
    }
    Vendor {
        string id PK
        string name
        string tenantId FK
    }
    Location {
        string id PK
        string name
        string tenantId FK
    }
    Category {
        string id PK
        string name
        string tenantId FK
    }

    Tenant ||--o{ User : "擁有"
    Tenant ||--o{ Entry : "隔離"
    Tenant ||--o{ Revenue : "隔離"
    Tenant ||--o{ Item : "隔離"
    Tenant ||--o{ Vendor : "隔離"
    Tenant ||--o{ Location : "隔離"
    Entry }o--|| Item : "進貨品項"
    Entry }o--|| Vendor : "供應廠商"
    Revenue }o--|| Location : "場所"
    Item }o--|| Category : "分類"
```

---

## 目錄結構

```
t_web/
├── prisma/
│   ├── schema.prisma       # 資料庫模型定義
│   └── seed.ts             # 初始資料 (角色、super admin)
├── scripts/
│   ├── backup-db.ts        # 每日備份腳本（啟動時執行）
│   └── seed-demo-data.ts   # 展示用假資料（viewer 帳號用）
├── src/
│   ├── app/
│   │   ├── (protected)/    # 一般用戶功能（需登入）
│   │   │   ├── page.tsx            # 首頁儀表板
│   │   │   ├── entry/new/          # 新增進貨/支出
│   │   │   ├── inventory/          # 進貨記錄列表
│   │   │   ├── revenue/            # 每日營收記帳
│   │   │   ├── reports/            # 報表與分析
│   │   │   └── settings/           # 系統設定
│   │   ├── (super-admin)/  # 超級管理者後台
│   │   │   └── super-admin/
│   │   │       ├── page.tsx        # 系統總覽
│   │   │       └── tenants/        # 企業管理 CRUD
│   │   ├── actions/        # Next.js Server Actions
│   │   └── login/          # 登入頁面
│   ├── components/
│   │   ├── layout/
│   │   │   └── MobileNav.tsx       # 底部導覽列（iOS Safe Area 支援）
│   │   └── ui/                     # shadcn/ui 元件
│   └── lib/
│       ├── auth.ts         # 認證邏輯、getCurrentUser
│       ├── session.ts      # Cookie Session 簽名/驗證
│       └── prisma.ts       # Prisma Client 單例
├── docker-compose.yml      # Docker 部署配置
├── Dockerfile
└── Dockerfile.cloudflared
```

---

## 使用者角色

| 角色 | 代碼 | 權限 |
|------|------|------|
| 超級管理者 | ─ | 管理所有企業、進入任意企業、重設密碼 |
| 管理員 | admin | 所有功能 + 系統設定 |
| 操作員 | write | 新增/編輯進貨、營收記帳 |
| 查看者 | read | 僅查看儀表板、報表 |

---

## 備份策略

- **啟動時自動備份**：每次 `npm start` 或 `start:lan` 時執行 `scripts/backup-db.ts`
- **每日一次**：若當天已備份則跳過，避免重複
- **備份位置**：`C:\db-backups\t_web\dev_db_YYYYMMDD_HHMMSS.db`
- **保留策略**：
  - 最近 14 天：全部保留
  - 14 天 ~ 8 週：每週保留一份
  - 8 週 ~ 12 月：每月保留一份

---

## 快速開始

### 開發環境

```bash
# 安裝相依套件
npm install

# 建立環境變數
cp .env.example .env

# 資料庫初始化
npx prisma migrate dev
npx prisma db seed

# 啟動開發伺服器
npm run dev
```

### 正式部署（Docker）

```bash
# 建立並啟動容器（含 Cloudflare Tunnel）
docker compose up -d

# 查看 logs
docker compose logs -f market-ledger
```

### 本機啟動（不含 Docker）

```bash
# 區網模式（備份 + 啟動）
npm run start:lan
```

---

## 展示帳號

> 以下帳號可用於展示，資料涵蓋 2025-07-01 ～ 2026-02-07（飲料店業態，7 個月共 444 筆營收 + 660 筆進貨/支出）

| 用途 | 帳號 | 密碼 | 角色 |
|------|------|------|------|
| 超級管理者 | admin | admin112233 | 超級管理者 |
| 企業管理員 | 1111 | 0000 | 管理員 |
| 展示查看 | viewer | viewer123 | 查看者 |

---

## 環境變數

| 變數 | 說明 | 範例 |
|------|------|------|
| `DATABASE_URL` | SQLite 路徑 | `file:./prisma/dev.db` |
| `SESSION_SECRET` | Session 簽名金鑰（至少 32 字元） | 隨機字串 |
| `CLOUDFLARED_DIR` | cloudflared 憑證目錄 | `C:/Users/xxx/.cloudflared` |

---

## 行動裝置支援

- **iOS Safe Area**：底部導覽列自動適應 iPhone 的 Home Indicator 空間
- **防縮放**：輸入欄位字型大小 ≥ 16px，防止 iOS 自動縮放
- **觸控優化**：所有互動元素觸控區域 ≥ 44×44px（Apple HIG 標準）
- **PWA 支援**：可加入 iPhone 主畫面，以獨立 App 模式運行
- **Viewport Fit**：支援瀏海/動態島 iPhone 的全螢幕顯示
