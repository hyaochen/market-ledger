# claude-bridge（T-ML-024 + T-ML-026 收尾）

Host 端的小 HTTP service，把 `claude -p`（走 owner 的 Claude Pro/Max **訂閱**，不是 API key）包成
一個 `market-ledger-bot` 容器可以打的 endpoint。跟現有「容器打 host 上的 Ollama」是同一種架構，
差別只是把 Ollama 換成 `claude -p`。

```
[market-ledger-bot 容器]
      │ POST http://host.docker.internal:5055/chat
      ▼
[claude-bridge（這個服務，跑在 host，bind 127.0.0.1）]
      │ spawn claude.exe -p --safe-mode ...
      ▼
[claude CLI（host 上已用 owner 的訂閱登入）]
```

容器內沒有 `claude` CLI 也沒有訂閱憑證，所以 bridge 必須跑在 host 上。

---

## 啟動

### 手動前景執行（除錯用）

```powershell
cd C:\Users\a0927\Desktop\t_web
npm run claude-bridge
# 或直接：node scripts/claude-bridge/bridge.js
```

前景執行即可（跟開發用的 `npm run dev` 一樣），Ctrl+C 停止。

### 開機自啟（T-ML-026，建議常駐用這個）

T-ML-024 當時刻意不設開機自啟；T-ML-026 補上，理由是「bridge 沒開機自啟 → 重開機後
bot 靜默退回 ollama，且沒人知道」是已知的實務風險（owner 8/7 選 A+B 批准修）。

```powershell
npm run claude-bridge:register
```

這會用 `schtasks /Create /XML` 匯入 `scripts/tasks/market-ledger-claude-bridge.xml`，
註冊一個叫 **`market-ledger-claude-bridge`** 的排程工作：

- **觸發**：`LogonTrigger`（owner 帳號登入 Windows 時，登入後延遲 10 秒），Principal 用
  `InteractiveToken` + owner 的 SID（跟 trading-bot 專案既有排程用同一套機制，這台機器上已驗證
  過不需要系統管理員權限就能註冊）
- **不彈視窗**：node.exe 是 console-subsystem 執行檔，沒有 `pythonw.exe` 那種零視窗版本可用。
  實際流程是 `wscript.exe run-hidden.vbs`（GUI-subsystem，永遠不開 console）→
  `WScript.Shell.Run(..., windowStyle=0, waitOnReturn=False)` 隱藏啟動
  `scripts/claude-bridge/run-hidden.bat` → bat 迴圈裡再啟動 `node scripts/claude-bridge/bridge.js`。
  已用 `Get-Process | Select MainWindowHandle` 實測整條 process tree 的 `MainWindowHandle` 全部是
  `0`（=沒有視窗），不是用肉眼「應該看不到」猜的
- **當機自動重啟**：`run-hidden.bat` 本身是個迴圈——`bridge.js` 結束（不管是 crash 還是被砍）就等
  5 秒重啟，並把 log 追加寫進 `logs/claude-bridge.log`。**刻意不依賴** schtask 自己的
  `RestartOnFailure`（那個只會盯 `wscript.exe` 這個啟動器本身，`wscript.exe` 幾乎瞬間就正常結束
  返回了，跟它後面真正常駐的 `node.exe` 是否還活著無關，schtask 層級的重啟設定在這裡形同虛設）
- **XML 編碼**：`scripts/tasks/market-ledger-claude-bridge.xml` 宣告 `encoding="UTF-16"`，檔案也
  真的用 `[System.IO.File]::WriteAllText(path, content, [System.Text.Encoding]::Unicode)` 存成
  UTF-16LE + BOM（`FF FE` 開頭）——trading-bot 專案踩過「宣告 UTF-16 但檔案是 Write 工具預設的
  UTF-8」的 mismatch 雷，這次直接對齊那個修法

**確認自啟真的在跑**（不用真的重開機）：

```powershell
schtasks /Run /TN "market-ledger-claude-bridge"
curl http://127.0.0.1:5055/health
```

**停用自啟**：

```powershell
npm run claude-bridge:stop              # 只停掉目前在跑的 process，排程仍會在下次登入時啟動
npm run claude-bridge:stop -- -RemoveTask   # 額外把排程工作也刪掉，之後登入不會再自動啟動
```

（或直接：`powershell -ExecutionPolicy Bypass -File scripts/claude-bridge/stop-bridge.ps1 -RemoveTask`）

## 確認在跑

```powershell
curl http://127.0.0.1:5055/health
```

預期回傳類似：
```json
{"ok":true,"model":"sonnet","maxConcurrent":2,"activeCount":0,"queueLength":0,"pid":12345,"uptimeSec":10}
```

啟動時的第一行 log 會印出實際解析到的 claude 執行檔路徑，例如：
```
[claude-bridge] claude bin: C:\Users\...\node_modules\@anthropic-ai\claude-code\bin\claude.exe (shell=false)
```
如果看到 `shell=true` 且緊接著一大段 WARNING，代表沒找到底層 `.exe`、退回了有 quoting 風險的
`claude.cmd` 路徑（見下方「已知踩坑」），這時中文/JSON prompt 可能會被 cmd.exe 切爛，
應該設定 `CLAUDE_BRIDGE_BIN` 環境變數指到正確的 `claude.exe`。

## 停止

- 前景執行：視窗按 `Ctrl+C`（有處理 SIGINT/SIGTERM，會乾淨關閉 HTTP server）。
- 開機自啟模式：`npm run claude-bridge:stop`（見上方「開機自啟」段落）。

---

## bot 啟動健康檢查 + Telegram 告警（T-ML-026 B）

`bot/index.ts` 啟動時（`preloadStates()` 之後、`bot.startPolling()` 之前）會呼叫
`bot/bridgeHealth.ts` 的 `runStartupBridgeHealthCheck()` 打一次 `/health`：

- `LLM_PROVIDER != claude` → 直接跳過（bridge 本來就沒在用）
- 健康 → log 一行，什麼都不做
- 不健康 → 找 owner 的 Telegram chat id，發一則告警（說明 bridge 沒跑 → 已自動退回本地 ollama →
  正確率會下降 → 請執行 `npm run claude-bridge`）

**只在啟動時檢查一次，不是常駐輪詢**——`bot/parser.ts` 本來就會每筆訊息各自無感 fallback 到
ollama，如果健康檢查也做成每次解析都跑一次還告警，會變成訊息騷擾。程式碼裡有一個
process 層級的 `alreadyAlertedThisProcess` flag 防重複告警（純防禦性，目前設計下本來就只會被
呼叫一次）。

**owner chat id 怎麼找**：掃 `SystemConfig` 裡的 `tg_session_*`（跟 `bot/auth.ts` /
`bot/state.ts` preloadStates 用同一份 key 格式），找出 session 裡 `userId` 對應
`User.isSuperAdmin === true` 的那一筆，用它的 key 尾碼（= Telegram 私聊時的 chat id）當收件人。
**沒有寫死 chat id，也沒有讀 `.env`**——完全沿用 bot 既有的登入機制。

🔴 **已知落地缺口（2026-08-07 實測發現）**：目前 DB 裡 `isSuperAdmin=true` 的帳號（`chen` /
`superadmin`）**從來沒有透過 Telegram 登入過這個 bot**——只有 `mom` 這個非 admin 帳號在用。
也就是說現在告警機制程式碼正確、也真的跑過（見下方驗證記錄），但**目前沒有地方可以送**：
`findOwnerChatId()` 會正確回傳 `null`，log 一行警告，bot 正常繼續 polling，不會壞掉，但 owner
收不到任何 Telegram 訊息。**要讓這個機制真的能通知到人，owner 需要自己用 Telegram 傳一次
`chen <密碼>` 或 `superadmin <密碼>` 給這支 bot 完成登入**（7 天效期，過期要再登入一次）。

---

## 環境變數（全部有預設值，不用特別設）

| 變數 | 預設 | 說明 |
|---|---|---|
| `CLAUDE_BRIDGE_PORT` | `5055` | 監聽 port。**不要用 5051** —— wiki 專案的舊 bridge 用那個 port（目前沒在跑，但避免以後撞號）|
| `CLAUDE_BRIDGE_MODEL` | `sonnet` | 傳給 `claude -p --model` 的預設模型，可用 `sonnet` / `haiku` / `opus` 或完整 model id |
| `CLAUDE_BRIDGE_MAX_CONCURRENT` | `2` | 同時最多跑幾個 `claude -p` process（並發保護，見下方） |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `25000` | 單一請求的總預算（排隊等待 + 執行時間）。刻意小於 `parser.ts` 呼叫端的 30s fetch timeout，讓 bridge 有機會先回一個乾淨的錯誤 JSON |
| `CLAUDE_BRIDGE_BIN` | 自動偵測 | 手動指定 claude 執行檔路徑（遇到自動偵測失敗時用，見下方踩坑記錄）|

🔴 **`CLAUDE_BRIDGE_BIND`（或任何形式的「讓它聽 0.0.0.0」）刻意沒有實作** —— bind 寫死在程式碼裡
是 `127.0.0.1`，不接受環境變數覆寫。見下方「為什麼一定要 127.0.0.1」。

---

## 為什麼一定要 127.0.0.1（不可以 0.0.0.0）

wiki 專案的 `rag/claude_bridge.py` 曾經把 bind 設成 `0.0.0.0`，結果同一個區網（LAN）上**任何裝置**
都能不驗證身分直接打這個 endpoint，等於任何人都能免費消耗 owner 的 Claude 訂閱額度。這是已知安全
事故，這次重寫時特別把 bind 寫死、不開放環境變數覆寫，就是為了不讓同樣的錯誤能被「順手改掉」。

Docker Desktop 的 `host.docker.internal` 有能力連到只 bind `127.0.0.1` 的 host 服務（這點已經在
這台機器上驗證過：現有的 Ollama 就是 `127.0.0.1:11434`-only，`market-ledger-bot` 容器目前就是靠
`host.docker.internal:11434` 正常打到它）。這是 Docker Desktop 內部網路 proxy 的行為，跟裸
Linux Docker（沒有 Desktop）不一樣 —— 如果哪天搬去裸 Linux host，這個假設要重新驗證。

`docker-compose.yml` 的 `market-ledger-bot` service 已經有 `extra_hosts: host.docker.internal:host-gateway`
（原本是為了 Ollama 加的），bridge 沿用同一條路徑，不需要額外改網路設定。

---

## 已知踩坑記錄（寫給下一個要動這支程式的人）

### 1. Windows 上 spawn `.cmd` 檔必須 `shell:true`，但 `shell:true` 不會跳脫參數

`claude` 在 Windows PATH 上其實是 `claude.cmd`（一個小 batch shim）。Node 的
`child_process.spawn()` 對 `.cmd`/`.bat` 檔案在 `shell:false` 時會直接丟 `EINVAL`
（Node 的安全修正，防止 CVE-2024-27980 那類注入）。但改成 `shell:true` 又踩到另一個更陰的坑：
**Windows 上 `shell:true` 不會對陣列型的 `args` 做任何跳脫，只是用空白直接 join 後丟給
`cmd.exe`**（Node 官方文件有寫，但很容易漏看）。我們的 `--system-prompt` 內容同時有空白、中文、
JSON 特殊字元三個地雷全踩，結果是：**不會報錯**，但 `cmd.exe` 的 tokenizer 把參數切爛，claude
收到的參數位置全部錯位 —— 實測現象是 `--system-prompt` 形同沒生效，claude 退回一般 Claude Code
agent 的行為（反問使用者「你要我做什麼」），而且明顯變慢（~7.5s vs 正常 ~4-5s）。**看起來像是
「LLM 不聽指令」，其實是 shell quoting 把參數陣列打散了**，非常難從症狀反推根因。

修法：`claude.cmd` 內容其實只是
```bat
"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
```
一個轉呼叫。`bridge.js` 的 `resolveClaudeBin()` 會去讀 PATH 上的 `claude.cmd`，解析出裡面真正的
`.exe` 路徑，直接 `spawn(那個.exe, args, {shell:false})` —— 跳過 cmd.exe 整個環節，Node 對
非 shell spawn 的 Windows 參數跳脫是正確且有測試覆蓋的行為，中文/空白/JSON 都不會被咬。
如果自動偵測失敗（例如 claude 用別的方式安裝，PATH 上找不到 `claude.cmd`），會退回
`claude.cmd + shell:true`（一樣有 quoting 風險）並在啟動時印警告 —— 這時應該設定
`CLAUDE_BRIDGE_BIN` 手動指到正確的 `claude.exe`。

### 2. 一定要加 `--safe-mode`，否則 CLAUDE.md / auto-memory 會外洩進 bot 的解析結果

沒加 `--safe-mode` 之前實測：`claude -p` 即使給了 `--system-prompt` 覆蓋系統提示，還是會載入
owner 的全域 `~/.claude/CLAUDE.md` 和 auto-memory（`MEMORY.md`），導致：
- claude 用「俗頭」人設回話、反問使用者要記到哪個專案（提到其他專案名稱，等於把 owner 的其他
  專案資訊洩漏進記帳 bot 的回覆裡）
- 明顯變慢（實測 ~26s，vs 加了 `--safe-mode` 之後 ~4-5s）

`--safe-mode` 會關掉 CLAUDE.md / skills / plugins / hooks / auto-memory，但保留 OAuth
訂閱認證正常運作（這點跟 `--bare` 不一樣 —— `--bare` 效果類似但會強制要求 `ANTHROPIC_API_KEY`，
不吃 OAuth，等於繞過訂閱認證，違背這個 task「用訂閱額度」的目的）。

### 3. `claude -p --model haiku` 沒有比較快

實測 haiku 走 `claude -p`（CLI subprocess）反而比 sonnet 略慢一點（~6s vs ~4.7-5.1s），因為
瓶頸主要是 CLI process 啟動開銷（載入 agent、驗證 auth 等），不是模型推論時間本身。如果之後
owner 決定要走「Claude API + Haiku」而不是「`claude -p` CLI」，那是完全不同的呼叫路徑（直接
API call，不經過 CLI 啟動流程），速度特性會不一樣，不能直接套用這裡的結論。

### 4. `--safe-mode` 不擋工具，`--disallowed-tools` 清單也要涵蓋這台機器實際有的工具（T-ML-026 C）

`--safe-mode` 的 `--help` 白紙黑字寫「Auth, model selection, **built-in tools, and permissions
work normally**」——它只清系統提示（CLAUDE.md/skills/plugins/hooks/auto-memory），完全不管工具
權限。實測（`--safe-mode` 但沒加 `--tools`/`--disallowed-tools`）：問 claude 一個「答案只寫在
`~/.claude/CLAUDE.md` 和 `vault/projects/memoria/*.md` 裡」的問題，它會**主動用工具去讀那些檔案**
然後正確答出來——等於記帳 bot 的 LLM 呼叫可以被誘導翻主機任意檔案。

修法是雙層擋：既有的 `'--tools', ''`（空白名單，經驗證單獨就能完全擋住）+ 新加的
`--disallowed-tools`（明確黑名單，防未來版本新增預設開的工具繞過空白名單）。

🔴 **Windows 專屬踩坑**：一開始用通用 Unix 清單
`Read Grep Glob Bash Task WebFetch WebSearch Edit Write NotebookEdit` 測，**完全沒擋住**——
用 `--output-format stream-json --verbose` 攤開實際呼叫的工具才發現，這台機器的 claude CLI 把
**`PowerShell`** 列成跟 `Bash` 平行的獨立工具（不是同一個），claude 直接改用 `PowerShell`
讀檔繞過清單；另外還用了 `ToolSearch`（執行期動態載入其他延遲工具）。清單補上
`PowerShell ToolSearch Agent Skill` 後才真的擋住（見 `scripts/claude-bridge/bridge.js` 裡
`runClaude()` 的完整清單和驗證記錄）。**教訓**：光看官方文件列的通用工具名稱清單不夠，同一支
CLI 在不同作業系統/環境下實際暴露的工具集合可能不同，黑名單要用 `--verbose` 攤開真實呼叫來驗證，
不能憑經驗直接抄別的平台的清單。

---

## 並發保護

同時最多 `CLAUDE_BRIDGE_MAX_CONCURRENT`（預設 2）個 `claude -p` process 在跑。超過的請求會排隊，
但整體等待時間（排隊 + 執行）受 `CLAUDE_BRIDGE_TIMEOUT_MS` 限制，逾時直接回 `503 busy`
（呼叫端 `bot/parser.ts` 會視為 fallback 條件之一，自動退回 ollama）。

## Log

stdout 一行一個 JSON（`request_received` / `request_done` / `request_error` / `request_rejected` /
`startup` / `shutdown`），方便之後用 `findstr` / `grep` 撈。沒有寫檔案，前景執行的話終端機視窗
關掉 log 就沒了 —— 如果要留存，執行時自己 `> bridge.log 2>&1` 重導向。
