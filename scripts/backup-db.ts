import fs from "fs";
import path from "path";
import os from "os";

// Docker mode uses docker-data/dev.db; dev mode uses prisma/dev.db
const dockerSource = path.resolve("docker-data", "dev.db");
const devSource = path.resolve("prisma", "dev.db");
const source = fs.existsSync(dockerSource) ? dockerSource : devSource;

// 備份到專案外的獨立位置，確保資料安全
// Windows: C:\db-backups\t_web\
// 其他系統: ~/db-backups/t_web/
const backupRoot = process.platform === "win32"
    ? "C:\\db-backups\\t_web"
    : path.join(os.homedir(), "db-backups", "t_web");
const backupDir = backupRoot;
const logFile = path.join(backupDir, "backup.log");

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

function appendLog(msg: string) {
    const line = `${msg}\n`;
    fs.appendFileSync(logFile, line, "utf-8");
    process.stdout.write(line);
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

function main() {
    if (!fs.existsSync(source)) {
        console.error(`[ERROR] Source database not found: ${source}`);
        process.exit(1);
    }

    ensureDir(backupDir);

    const now = new Date();
    const today = todayStr(now);

    // 檢查今天是否已經備份過，若已備份則跳過
    const existingFiles = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    const alreadyBackedUpToday = existingFiles.some((f) => f.startsWith(`dev_db_${today}`));

    if (alreadyBackedUpToday) {
        appendLog(`[${now.toISOString()}] Backup skipped: already backed up today (${today})`);
        return;
    }

    // 執行備份
    const timestamp = formatTimestamp(now);
    const backupName = `dev_db_${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    fs.copyFileSync(source, backupPath);
    const sizeKB = Math.round(fs.statSync(backupPath).size / 1024);
    appendLog(`[${now.toISOString()}] Backup created: ${backupPath} (${sizeKB} KB)`);

    // 清理舊備份
    const allFiles = fs.readdirSync(backupDir);
    const backups = allFiles
        .map((file) => ({ file, date: parseTimestamp(file) }))
        .filter((item): item is { file: string; date: Date } => Boolean(item.date))
        .sort((a, b) => b.date.getTime() - a.date.getTime());

    const keptWeeks = new Set<string>();
    const keptMonths = new Set<string>();
    const keepSet = new Set<string>();

    for (const backup of backups) {
        if (shouldKeep(backup.date, now, keptWeeks, keptMonths)) {
            keepSet.add(backup.file);
        }
    }

    let removed = 0;
    for (const backup of backups) {
        if (!keepSet.has(backup.file)) {
            fs.unlinkSync(path.join(backupDir, backup.file));
            removed++;
        }
    }

    if (removed > 0) {
        appendLog(`[${now.toISOString()}] Cleanup: removed ${removed} old backup(s), kept ${keepSet.size}`);
    }
}

main();
