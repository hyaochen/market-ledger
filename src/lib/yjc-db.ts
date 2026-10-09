// POS (YJC) mirror database.
//
// 攤位的舊 POS（育禎 YJC / SQL Server）由 yjc-sync 鏡像成批次檔，經 POST /api/pos-import
// 送進來。資料存在「獨立的 SQLite 檔 yjc.db」，與 Prisma 的主資料庫（dev.db）完全分開：
//   - 這是 POS 的鏡像，壞了可以整個重建，不該拖累記帳主庫
//   - 欄位由廠商決定（改版會加欄位），不適合綁 Prisma schema
// 檔案放在跟 dev.db 同一個 volume 目錄（容器內 /app/data），所以跟著 named volume 持久化。

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const POS_TABLES = [
    "i_orders",
    "i_items",
    "i_checks",
    "i_ShiftTotal",
    "i_ordersDelete",
    "i_itemsDelete",
    "i_food",
    "i_foodkind",
    "i_checkKind",
    "i_cashkind",
    "i_reason",
    "i_shiftOpLog",
    "i_ShiftCashSum",
    "i_shiftCheckSum",
    "i_timeSeg",
    "i_seat",
    "i_Lastshift",
    "i_shift",
    "i_pricetime",
] as const;

const TABLE_SET = new Set<string>(POS_TABLES);
const IDENT_RE = /^[A-Za-z0-9_]+$/;

export function isPosTable(name: string): boolean {
    return TABLE_SET.has(name);
}

export function isSafeIdent(name: unknown): name is string {
    return typeof name === "string" && name.length > 0 && name.length <= 64 && IDENT_RE.test(name);
}

function quoteIdent(name: string): string {
    // 只有通過 IDENT_RE 的名字才會走到這裡，雙引號包起來純粹是避開 SQL 保留字
    return `"${name}"`;
}

// ---------------------------------------------------------------------------
// 連線

function resolveDbPath(): string {
    if (process.env.YJC_DB_PATH) return path.resolve(process.env.YJC_DB_PATH);
    const url = process.env.DATABASE_URL || "";
    if (url.startsWith("file:")) {
        const p = url.slice("file:".length).split("?")[0];
        // Prisma 的相對路徑是相對 prisma/ 目錄；容器內是絕對路徑 /app/data/dev.db
        const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), "prisma", p);
        return path.join(path.dirname(abs), "yjc.db");
    }
    return path.resolve(process.cwd(), "yjc.db");
}

const INDEXES: Array<{ table: string; column: string }> = [
    { table: "i_orders", column: "m_OrderNo" },
    { table: "i_orders", column: "m_WorkDate" },
    { table: "i_items", column: "p_OrderID" },
    { table: "i_checks", column: "c_OrderID" },
    { table: "i_ShiftTotal", column: "z_workdate" },
];

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

export function getYjcDb(): Database.Database {
    const target = resolveDbPath();
    if (_db && _dbPath === target) return _db;
    if (_db) {
        try {
            _db.close();
        } catch {
            /* ignore */
        }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const db = new Database(target);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("busy_timeout = 15000");
    db.exec(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);
    _db = db;
    _dbPath = target;
    ensureIndexes(db);
    return db;
}

function tableColumns(db: Database.Database, table: string): string[] {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
}

export function listTableColumns(table: string): string[] {
    if (!isPosTable(table)) return [];
    return tableColumns(getYjcDb(), table);
}

function ensureIndexes(db: Database.Database) {
    for (const ix of INDEXES) {
        const cols = tableColumns(db, ix.table);
        if (cols.includes(ix.column)) {
            db.exec(
                `CREATE INDEX IF NOT EXISTS ${quoteIdent(`ix_${ix.table}_${ix.column}`)} ` +
                    `ON ${quoteIdent(ix.table)} (${quoteIdent(ix.column)})`
            );
        }
    }
}

export function getLastImportAt(): string | null {
    try {
        const row = getYjcDb().prepare(`SELECT value FROM _meta WHERE key = 'last_import_at'`).get() as
            | { value: string }
            | undefined;
        return row?.value ?? null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// 匯入

export class PosImportError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

type Scalar = string | number | null;

type ParsedOp =
    | { kind: "clear"; table: string }
    | { kind: "delete_in"; table: string; column: string; values: Scalar[] }
    | { kind: "insert"; table: string; columns: string[]; rows: Scalar[][] };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeScalar(v: unknown, where: string): Scalar {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") {
        if (!Number.isFinite(v)) throw new PosImportError(`${where}: 非有限數值`);
        return v;
    }
    if (typeof v === "boolean") return v ? 1 : 0;
    throw new PosImportError(`${where}: 不支援的值型別`);
}

/** 先完整驗證所有 op（表名白名單、欄位名格式、列長度），驗過才開 transaction。 */
export function parseOps(body: unknown): ParsedOp[] {
    if (!isRecord(body) || !Array.isArray(body.ops)) {
        throw new PosImportError("body 必須是 {ops: [...]}");
    }
    const out: ParsedOp[] = [];
    body.ops.forEach((raw, i) => {
        const where = `ops[${i}]`;
        if (!isRecord(raw)) throw new PosImportError(`${where}: 必須是物件`);
        const table = raw.table;
        if (typeof table !== "string" || !isPosTable(table)) {
            throw new PosImportError(`${where}: 不在白名單的表`);
        }
        switch (raw.op) {
            case "clear":
                out.push({ kind: "clear", table });
                break;
            case "delete_in": {
                if (!isSafeIdent(raw.column)) throw new PosImportError(`${where}: 欄位名不合法`);
                if (!Array.isArray(raw.values)) throw new PosImportError(`${where}: values 必須是陣列`);
                const values = raw.values.map((v, j) => normalizeScalar(v, `${where}.values[${j}]`));
                out.push({ kind: "delete_in", table, column: raw.column, values });
                break;
            }
            case "insert": {
                if (!Array.isArray(raw.columns) || raw.columns.length === 0) {
                    throw new PosImportError(`${where}: columns 必須是非空陣列`);
                }
                const columns: string[] = [];
                for (const c of raw.columns) {
                    if (!isSafeIdent(c)) throw new PosImportError(`${where}: 欄位名不合法`);
                    columns.push(c);
                }
                if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length) {
                    throw new PosImportError(`${where}: 欄位名重複`);
                }
                if (!Array.isArray(raw.rows)) throw new PosImportError(`${where}: rows 必須是陣列`);
                const rows = raw.rows.map((r, j) => {
                    if (!Array.isArray(r) || r.length !== columns.length) {
                        throw new PosImportError(`${where}.rows[${j}]: 欄位數與 columns 不符`);
                    }
                    return r.map((v, k) => normalizeScalar(v, `${where}.rows[${j}][${k}]`));
                });
                out.push({ kind: "insert", table, columns, rows });
                break;
            }
            default:
                throw new PosImportError(`${where}: 未知的 op`);
        }
    });
    return out;
}

const DELETE_CHUNK = 500;

export function applyOps(ops: ParsedOp[]): { ops: number; rows: number } {
    const db = getYjcDb();
    let rows = 0;

    const run = db.transaction(() => {
        for (const op of ops) {
            const t = quoteIdent(op.table);
            const existing = tableColumns(db, op.table);
            const exists = existing.length > 0;

            if (op.kind === "clear") {
                if (exists) db.exec(`DELETE FROM ${t}`);
                continue;
            }

            if (op.kind === "delete_in") {
                if (!exists) continue;
                if (!existing.includes(op.column)) {
                    throw new PosImportError(`${op.table} 沒有欄位 ${op.column}`);
                }
                const col = quoteIdent(op.column);
                for (let i = 0; i < op.values.length; i += DELETE_CHUNK) {
                    const chunk = op.values.slice(i, i + DELETE_CHUNK);
                    const marks = chunk.map(() => "?").join(",");
                    db.prepare(`DELETE FROM ${t} WHERE ${col} IN (${marks})`).run(...chunk);
                }
                continue;
            }

            // insert
            if (!exists) {
                // 欄位不宣告型別：值怎麼來就怎麼存，廠商改版加欄位也不會卡型別
                db.exec(`CREATE TABLE ${t} (${op.columns.map(quoteIdent).join(", ")})`);
            } else {
                const have = new Set(existing.map((c) => c.toLowerCase()));
                for (const c of op.columns) {
                    if (!have.has(c.toLowerCase())) {
                        db.exec(`ALTER TABLE ${t} ADD COLUMN ${quoteIdent(c)}`);
                    }
                }
            }
            if (op.rows.length === 0) continue;
            const stmt = db.prepare(
                `INSERT INTO ${t} (${op.columns.map(quoteIdent).join(", ")}) ` +
                    `VALUES (${op.columns.map(() => "?").join(", ")})`
            );
            for (const r of op.rows) stmt.run(r);
            rows += op.rows.length;
        }
        db.prepare(
            `INSERT INTO _meta (key, value) VALUES ('last_import_at', ?) ` +
                `ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(new Date().toISOString());
    });

    run();
    // 表可能剛被建立：補上索引（已存在則略過）
    ensureIndexes(db);
    return { ops: ops.length, rows };
}
