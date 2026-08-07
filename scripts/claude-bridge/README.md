# claude-bridge（T-ML-024）

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

```powershell
cd C:\Users\a0927\Desktop\t_web
npm run claude-bridge
# 或直接：node scripts/claude-bridge/bridge.js
```

前景執行即可（跟開發用的 `npm run dev` 一樣）。**這個 task 刻意不設開機自啟 / 不註冊 schtask** —
要不要常駐、要不要做成 Windows service，是 owner 的決定，不在這次範圍內。

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

前景視窗按 `Ctrl+C`（有處理 SIGINT/SIGTERM，會乾淨關閉 HTTP server）。

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

---

## 並發保護

同時最多 `CLAUDE_BRIDGE_MAX_CONCURRENT`（預設 2）個 `claude -p` process 在跑。超過的請求會排隊，
但整體等待時間（排隊 + 執行）受 `CLAUDE_BRIDGE_TIMEOUT_MS` 限制，逾時直接回 `503 busy`
（呼叫端 `bot/parser.ts` 會視為 fallback 條件之一，自動退回 ollama）。

## Log

stdout 一行一個 JSON（`request_received` / `request_done` / `request_error` / `request_rejected` /
`startup` / `shutdown`），方便之後用 `findstr` / `grep` 撈。沒有寫檔案，前景執行的話終端機視窗
關掉 log 就沒了 —— 如果要留存，執行時自己 `> bridge.log 2>&1` 重導向。
