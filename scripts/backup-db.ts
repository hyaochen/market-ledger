// T-ML-030 範圍 C — host 端備份協調腳本（每天 03:00 由 Windows 排程 t_web-daily-backup
// 呼叫：cmd.exe /c cd /d t_web && npm run backup:db >> C:\db-backups\t_web\backup.log 2>&1）。
//
// 2026-08-11 事故後的三個修復：
//
// Bug 1（撕裂/漏交易風險 + stale handle 的週期性觸發源）：
//   舊版直接 fs.copyFileSync 複製 live WAL 中的 dev.db，且沒複製 -wal/-shm，備份可能
//   是撕裂的或漏掉最新交易；更嚴重的是它每天從 host 開一次這個檔案，這正是事故根因
//   「host 端 process 開過 bind mount 上的 dev.db 之後，容器內已開啟的 handle 變
//   stale」的其中一個週期性觸發源。改法：host 完全不碰 live dev.db —— 靜態快照由
//   scripts/backup-snapshot.ts 在容器內用 VACUUM INTO 產生（寫到容器自己的 /tmp，不是
//   bind mount），host 只用 `docker cp` 把已經是靜態檔案的快照搬出來。
//
// Bug 2（保留清理從來沒執行過）：
//   舊版 appendLog() 用 fs.appendFileSync 開日誌檔，但排程用 `>>` 重導向已經占住
//   backup.log，第二次開檔在 Windows 上會噴 EBUSY，被最外層 catch 吞掉後 exit(0)，
//   導致「執行備份」之後的清理邏輯永遠跑不到（堆積 157 個檔案 / 265.5 MB 的直接原因）。
//   改法：拿掉 fs.appendFileSync，只 console.log 讓排程的 `>>` 統一收集；log 函式本身
//   包 try/catch，確保記錄失敗絕不中斷主流程。
//
// Bug 3（積欠的 157 個舊備份 —— 紅線：本次不准真的刪）：
//   保留邏輯修好後，"下一次" 排程觸發就會一次把積欠的舊檔案全部清掉 —— 但這批是因為
//   bug 才累積的歷史欠款，owner 還沒看過清單就自動刪掉不符合「絕對不刪任何檔案除非
//   owner 明確說刪」的紅線。改法：清理動作額外多一道**核准閘門**——只有
//   `C:\db-backups\t_web\.cleanup-approved` 這個 marker 檔案存在時才會真的
//   fs.unlinkSync；不存在時清理邏輯照樣完整跑一遍（維持修好的邏輯是「活的」，不是
//   死碼），但只 log「本來會刪什麼」不動手。owner 看過 dry-run 報告核准後，找主控或
//   下個 task 建立這個 marker 檔案，之後每天的清理才會真的動手（一次性 marker，建立
//   後就是永久生效的正常運作，不需要每天重新核准）。
//
//   人看的完整清單：npm run backup:cleanup-report（不受 marker 閘門影響，隨時可看，
//   不會刪任何東西）。

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "node:child_process";

const CONTAINER = "market-ledger-bot"; // 唯一有完整 node_modules（含 tsx）的 image target，T-ML-027/028/029 backfill 沿用的執行位置
const CONTAINER_SNAPSHOT_SCRIPT = "scripts/backup-snapshot.ts";

// 備份到專案外的獨立位置，確保資料安全
// Windows: C:\db-backups\t_web\
// 其他系統: ~/db-backups/t_web/
const backupRoot = process.platform === "win32"
    ? "C:\\db-backups\\t_web"
    : path.join(os.homedir(), "db-backups", "t_web");
const backupDir = backupRoot;

// Bug 3 核准閘門：這個檔案存在才會真的刪除舊備份（見檔頭說明）
const APPROVAL_MARKER = path.join(backupDir, ".cleanup-approved");

const keepDays = 14;
const keepWeeks = 8;
const keepMonths = 12;

function formatTimestamp(date: Date) {
    const yyyy = date.getFullYear().toString();
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const dd = `${date.getDate()}`.padStart(2, "0");
    const hh = `${date.getHours()}`.padStart(2, "0");
    const mi = `${date.getMinutes()}`.padStart(2, "0");
    const ss = `${date.getSeconds()}`.padStart(2, "0");
    return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function todayStr(date: Date) {
    const yyyy = date.getFullYear().toString();
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const dd = `${date.getDate()}`.padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
}

function parseTimestamp(fileName: string) {
    const match = fileName.match(/dev_db_(\d{8})_(\d{6})\.db$/);
    if (!match) return null;
    const [datePart, timePart] = [match[1], match[2]];
    const year = Number.parseInt(datePart.slice(0, 4), 10);
    const month = Number.parseInt(datePart.slice(4, 6), 10) - 1;
    const day = Number.parseInt(datePart.slice(6, 8), 10);
    const hour = Number.parseInt(timePart.slice(0, 2), 10);
    const minute = Number.parseInt(timePart.slice(2, 4), 10);
    const second = Number.parseInt(timePart.slice(4, 6), 10);
    return new Date(year, month, day, hour, minute, second);
}

function diffInDays(date: Date, base: Date) {
    return (base.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function getWeekKey(date: Date) {
    const target = new Date(date.valueOf());
    target.setHours(0, 0, 0, 0);
    target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
    const week1 = new Date(target.getFullYear(), 0, 4);
    const week = Math.round(
        ((target.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    ) + 1;
    return `${target.getFullYear()}-W${week.toString().padStart(2, "0")}`;
}

function getMonthKey(date: Date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
}

function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Bug 2 修復：不再 fs.appendFileSync 開 backup.log（跟排程的 `>>` 重導向搶檔會 EBUSY）。
// 只 console.log，讓排程統一收集；try/catch 確保「記錄」這個動作本身絕不能中斷主流程。
function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    try {
        console.log(line);
    } catch {
        // 記錄失敗是非致命的，吞掉即可，不得影響備份/清理主流程
    }
}

function shouldKeep(date: Date, now: Date, keptWeeks: Set<string>, keptMonths: Set<string>) {
    if (diffInDays(date, now) <= keepDays) return true;

    const weeksAgo = Math.floor(diffInDays(date, now) / 7);
    if (weeksAgo < keepWeeks) {
        const weekKey = getWeekKey(date);
        if (!keptWeeks.has(weekKey)) {
            keptWeeks.add(weekKey);
            return true;
        }
    }

    const monthDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    if (monthDiff < keepMonths) {
        const monthKey = getMonthKey(date);
        if (!keptMonths.has(monthKey)) {
            keptMonths.add(monthKey);
            return true;
        }
    }

    return false;
}

function execCapture(cmd: string, args: string[]): string {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function describeExecError(err: unknown): string {
    const e = err as { message?: string; stderr?: Buffer | string; stdout?: Buffer | string };
    const stderrStr = e?.stderr ? (Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf-8") : String(e.stderr)) : "";
    const base = e?.message ?? String(err);
    return stderrStr ? `${base} | stderr: ${stderrStr.trim().slice(0, 500)}` : base;
}

// Bug 1 修復：host 完全不碰 live dev.db。容器內用 VACUUM INTO 產生靜態快照到 /tmp
// （不是 bind mount），host 只用 docker cp 把已經寫死的檔案搬出來，再清掉容器暫存。
function createSnapshotViaContainer(destPath: string): boolean {
    const containerTmpPath = `/tmp/backup-snapshot-${process.pid}-${Date.now()}.db`;
    try {
        const running = execCapture("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER]).trim();
        if (running !== "true") {
            log(`[ERROR] Container ${CONTAINER} is not running (state check returned "${running}") -- skip backup`);
            return false;
        }
    } catch (err) {
        log(`[ERROR] Could not inspect container ${CONTAINER}: ${describeExecError(err)}`);
        return false;
    }

    try {
        execCapture("docker", ["exec", CONTAINER, "npx", "tsx", CONTAINER_SNAPSHOT_SCRIPT, containerTmpPath]);
        execCapture("docker", ["cp", `${CONTAINER}:${containerTmpPath}`, destPath]);
        return true;
    } catch (err) {
        log(`[ERROR] Snapshot via container failed: ${describeExecError(err)}`);
        return false;
    } finally {
        try {
            execCapture("docker", ["exec", CONTAINER, "rm", "-f", containerTmpPath]);
        } catch {
            // best-effort 清理，容器內殘留幾 KB 暫存檔不影響正確性，不值得讓主流程失敗
        }
    }
}

function createBackupIfNeeded(now: Date): void {
    ensureDir(backupDir);
    const today = todayStr(now);

    const existingFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    const alreadyBackedUpToday = existingFiles.some((f) => f.startsWith(`dev_db_${today}`));
    if (alreadyBackedUpToday) {
        log(`Backup skipped: already backed up today (${today})`);
        return;
    }

    const timestamp = formatTimestamp(now);
    const backupName = `dev_db_${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    const ok = createSnapshotViaContainer(backupPath);
    if (!ok) {
        log(`[ERROR] Backup FAILED for ${today} -- no snapshot file created`);
        return;
    }

    const sizeKB = Math.round(fs.statSync(backupPath).size / 1024);
    log(`Backup created: ${backupPath} (${sizeKB} KB, via container VACUUM INTO)`);
}

interface BackupFile {
    file: string;
    date: Date;
}

function listBackups(): BackupFile[] {
    const allFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    return allFiles
        .map((file) => ({ file, date: parseTimestamp(file) }))
        .filter((item): item is BackupFile => Boolean(item.date))
        .sort((a, b) => b.date.getTime() - a.date.getTime());
}

function planCleanup(now: Date): { keepList: BackupFile[]; removeList: BackupFile[] } {
    const backups = listBackups();
    const keptWeeks = new Set<string>();
    const keptMonths = new Set<string>();
    const keepList: BackupFile[] = [];
    const removeList: BackupFile[] = [];
    for (const backup of backups) {
        if (shouldKeep(backup.date, now, keptWeeks, keptMonths)) {
            keepList.push(backup);
        } else {
            removeList.push(backup);
        }
    }
    return { keepList, removeList };
}

function fileSizeKB(file: string): number {
    const p = path.join(backupDir, file);
    return fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) : 0;
}

// Bug 3：清理邏輯本身修好、每天都會完整算一次，但只有 APPROVAL_MARKER 存在才會真的
// fs.unlinkSync。沒有 marker 時只記錄「本來會刪什麼」，不動手 —— 這是刻意的持續狀態，
// 不是一次性的，直到 owner 看過報告、明確核准為止。
function runCleanup(now: Date): void {
    const { keepList, removeList } = planCleanup(now);
    if (removeList.length === 0) {
        log(`Cleanup: nothing to remove (kept ${keepList.length})`);
        return;
    }

    const totalKB = removeList.reduce((s, b) => s + fileSizeKB(b.file), 0);
    const approved = fs.existsSync(APPROVAL_MARKER);

    if (!approved) {
        log(
            `Cleanup DRY-RUN (not approved -- create ${APPROVAL_MARKER} to enable real deletion): ` +
            `would remove ${removeList.length} file(s) / ~${Math.round((totalKB / 1024) * 10) / 10} MB, keep ${keepList.length}`
        );
        return;
    }

    let removed = 0;
    for (const backup of removeList) {
        try {
            fs.unlinkSync(path.join(backupDir, backup.file));
            removed++;
        } catch (err) {
            log(`[ERROR] failed to remove ${backup.file}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    log(`Cleanup: removed ${removed} old backup(s), kept ${keepList.length}`);
}

// 人看的完整清單（T-ML-030 Bug 3 交付物）。npm run backup:cleanup-report 呼叫，
// 不受 approval marker 影響、不會刪任何東西，隨時可重跑。
function printCleanupReport(now: Date): void {
    const { keepList, removeList } = planCleanup(now);
    const approved = fs.existsSync(APPROVAL_MARKER);

    console.log(`\n=== Backup retention plan @ ${now.toISOString()} ===`);
    console.log(`Policy: keep ${keepDays} days full + ${keepWeeks} weekly + ${keepMonths} monthly`);
    console.log(`Approval marker (${APPROVAL_MARKER}): ${approved ? "EXISTS -- real deletion is ENABLED" : "not present -- dry-run only"}\n`);

    console.log(`--- WOULD REMOVE (${removeList.length}) ---`);
    let removeKB = 0;
    for (const b of removeList) {
        const kb = fileSizeKB(b.file);
        removeKB += kb;
        console.log(`  - ${b.file}  (${b.date.toISOString().slice(0, 10)}, ${kb} KB)`);
    }

    console.log(`\n--- WOULD KEEP (${keepList.length}) ---`);
    let keepKB = 0;
    for (const b of [...keepList].sort((a, b) => a.date.getTime() - b.date.getTime())) {
        const kb = fileSizeKB(b.file);
        keepKB += kb;
        console.log(`  + ${b.file}  (${b.date.toISOString().slice(0, 10)}, ${kb} KB)`);
    }

    console.log(
        `\nSummary: remove ${removeList.length} file(s) / ~${Math.round((removeKB / 1024) * 10) / 10} MB` +
        `, keep ${keepList.length} file(s) / ~${Math.round((keepKB / 1024) * 10) / 10} MB`
    );
}

function main() {
    const args = process.argv.slice(2);
    const now = new Date();

    if (args.includes("--cleanup-report")) {
        printCleanupReport(now);
        return;
    }

    createBackupIfNeeded(now);
    runCleanup(now);
}

// 包住 main()：備份/清理失敗不可阻擋排程本身（exit 0 even on error，沿用既有行為）
try {
    main();
} catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Backup failed (non-fatal): ${msg}`);
    console.error('[backup-db] non-fatal error:', msg);
    process.exit(0);
}
