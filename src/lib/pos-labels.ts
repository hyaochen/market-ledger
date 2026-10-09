// POS 資料的中文對照表（單一來源）：表名、欄位名、預設顯示哪些欄位、數值怎麼顯示。
//
// 給攤位老闆和員工看的畫面不要出現 i_orders、m_Total 這類代號，所以所有頁面的標題都從這裡取。
//
// 欄位意思的依據：
//   1. 廠商操作手冊（yjc-sync/out/manual-features.md 的「名詞對照」）
//   2. 2026-10-09 對真實資料（約 6.6 萬張單）查值、查分布
// 沒有十足把握的名稱標 inferred: true（推斷），回報給 owner 確認；改名只要改這個檔。
//
// 「常用欄位」(common) 的挑法：整欄都是空值、0 或同一個值的欄位預設隱藏
// （例如銷售單的 m_Machine 全是 A、m_Man 全是 0）。例外：付款方式這種一看就要知道的欄位照常保留。
// 「顯示全部欄位」打開後，沒有對照的欄位顯示「其他（原代號）」，不亂翻。

import { KG_PER_TAIWAN_CATTY } from "./pos-constants";

export type CellKind = "text" | "money" | "number" | "flag" | "datetime" | "date" | "weight_kg";

export type ColumnDef = {
    key: string;
    label: string;
    kind?: CellKind;
    /** 預設顯示 */
    common?: boolean;
    /** 搜尋框的提示（有填才能被選為搜尋欄位） */
    hint?: string;
    /** 值對照（例如 'Z' -> '日結'） */
    values?: Record<string, string>;
    /** 名稱是推斷的，需 owner 確認 */
    inferred?: boolean;
};

export type TableDef = {
    key: string;
    label: string;
    columns: ColumnDef[];
};

const c = (
    key: string,
    label: string,
    kind: CellKind = "text",
    extra: Partial<ColumnDef> = {}
): ColumnDef => ({ key, label, kind, ...extra });

export const POS_TABLE_DEFS: TableDef[] = [
    {
        key: "i_orders",
        label: "銷售單",
        columns: [
            c("m_OrderNo", "單號", "text", { common: true, hint: "輸入單號，如 261009A0040" }),
            c("m_WorkDate", "營業日", "date", { common: true, hint: "輸入營業日，如 2026/10/09" }),
            c("m_SaleTime", "開單時間", "datetime", { common: true, hint: "輸入日期，如 2026-10-09" }),
            c("m_CloseTime", "結帳時間", "datetime", { common: true, hint: "輸入日期，如 2026-10-09" }),
            c("m_Total", "金額", "money", { common: true, hint: "輸入金額，如 227" }),
            c("m_PayTotal", "實收金額", "money", { common: true, hint: "輸入金額，如 227" }),
            c("m_AgioTotal", "折扣金額", "money", { common: true }),
            c("m_ChangeTotal", "找零", "money", { common: true }),
            c("m_OPERATOR", "開單人員代號", "text", { common: true, inferred: true }),
            c("m_LastModify", "最後修改時間", "datetime", { common: true }),
            c("m_Checkout", "已結帳", "flag"),
            c("m_Machine", "機台"),
            c("m_Shift", "班別"),
            c("m_CloseOperator", "結帳人員代號", "text", { inferred: true }),
            c("m_WorkTime", "開單時刻", "text", { inferred: true }),
            c("m_CloseWorkTime", "結帳時刻", "text", { inferred: true }),
            c("m_CloseWorkDate", "結帳營業日", "date", { inferred: true }),
            c("m_CheckTotal", "已付款金額", "money", { inferred: true }),
            c("m_InvoiceTotal", "應開發票金額", "money"),
            c("m_tax", "稅額", "money", { inferred: true }),
            c("m_BakField_1", "品項總數量", "text", { inferred: true }),
            c("m_Man", "男客人數", "number", { inferred: true }),
            c("m_Woman", "女客人數", "number", { inferred: true }),
            c("m_Child", "小孩人數", "number", { inferred: true }),
            c("m_Baby", "嬰兒人數", "number", { inferred: true }),
        ],
    },
    {
        key: "i_items",
        label: "銷售明細",
        columns: [
            c("p_OrderID", "單號", "text", { common: true, hint: "輸入單號，如 261009A0040" }),
            c("p_serno", "項次", "number", { common: true }),
            c("p_FoodName", "品名", "text", { common: true, hint: "輸入品名，如 豬腳" }),
            c("p_Count", "數量", "number", { common: true }),
            c("p_Weight", "重量（台斤）", "weight_kg", { common: true }),
            c("p_Price", "單價", "money", { common: true, hint: "輸入單價，如 310" }),
            c("p_Total", "小計", "money", { common: true, hint: "輸入金額，如 144" }),
            c("p_Return", "退貨", "flag", { common: true }),
            c("p_InputTime", "輸入時間", "datetime", { common: true, hint: "輸入日期，如 2026-10-09" }),
            c("p_FoodID", "品項編號", "text", { hint: "輸入品項編號，如 01001" }),
            c("p_KindID", "分類編號"),
            c("p_Operator", "操作人員代號", "text", { inferred: true }),
            c("p_PriceExpr", "重量換算（POS 顯示的斤兩）", "text", { inferred: true }),
            c("p_SubTotal", "小計（整數）", "number", { inferred: true }),
            c("p_LastModify", "最後修改時間", "datetime"),
        ],
    },
    {
        key: "i_checks",
        label: "付款紀錄",
        columns: [
            c("c_OrderID", "單號", "text", { common: true, hint: "輸入單號，如 261009A0040" }),
            c("c_KindName", "付款方式", "text", { common: true, hint: "輸入付款方式，如 現金" }),
            c("c_Total", "客人實付金額", "money", { common: true, hint: "輸入金額，如 227" }),
            c("c_CheckChange", "找零", "money", { common: true }),
            c("c_WorkDate", "營業日", "date", { common: true, hint: "輸入營業日，如 2026/10/09" }),
            c("c_InputTime", "付款時間", "datetime", { common: true }),
            c("c_Operator", "收銀人員代號", "text", { common: true, inferred: true }),
            c("c_serNO", "付款項次", "number"),
            c("c_Kind", "付款方式代碼"),
            c("c_WorkTime", "付款時刻", "text", { inferred: true }),
            c("c_LastModify", "最後修改時間", "datetime"),
        ],
    },
    {
        key: "i_ShiftTotal",
        label: "日結報表",
        columns: [
            c("z_workdate", "營業日", "date", { common: true, hint: "輸入營業日，如 2026/10/09" }),
            c("z_shift", "範圍", "text", {
                common: true,
                inferred: true,
                values: { "@": "全日（Z 帳）", A: "早班（交班單）" },
            }),
            c("z_name", "項目", "text", { common: true, hint: "輸入項目，如 銷售總額" }),
            c("z_value", "數值", "text", { common: true }),
            c("z_LastModify", "最後修改時間", "datetime", { common: true }),
            c("z_groupNo", "分組", "number", { inferred: true }),
            c("z_prefix", "分組前綴", "text", { inferred: true }),
        ],
    },
    {
        key: "i_ordersDelete",
        label: "作廢的單",
        columns: [
            c("m_OrderNo", "單號", "text", { common: true, hint: "輸入單號，如 230926A0002" }),
            c("m_WorkDate", "營業日", "date", { common: true }),
            c("m_SaleTime", "開單時間", "datetime", { common: true }),
            c("m_DeleteTime", "作廢時間", "datetime", { common: true }),
            c("m_Deletor", "作廢人員代號", "text", { common: true, inferred: true }),
            c("m_DeleteReason", "作廢原因", "text", { common: true, hint: "輸入原因，如 客戶不要" }),
            c("m_Total", "金額", "money", { common: true }),
            c("m_OPERATOR", "開單人員代號", "text", { inferred: true }),
        ],
    },
    {
        key: "i_itemsDelete",
        label: "刪除的品項",
        columns: [
            c("p_OrderID", "單號", "text", { common: true, hint: "輸入單號，如 230926A0002" }),
            c("p_serno", "項次", "number", { common: true }),
            c("p_FoodName", "品名", "text", { common: true, hint: "輸入品名，如 豬腳" }),
            c("p_Weight", "重量（台斤）", "weight_kg", { common: true }),
            c("p_Price", "單價", "money", { common: true }),
            c("p_Total", "小計", "money", { common: true }),
            c("p_DeleteTime", "刪除時間", "datetime", { common: true }),
            c("p_Deletor", "刪除人員代號", "text", { common: true, inferred: true }),
            c("p_DeleteReason", "刪除原因", "text", { common: true }),
        ],
    },
    {
        key: "i_food",
        label: "品項價目",
        columns: [
            c("f_No", "品項編號", "text", { common: true, hint: "輸入編號，如 01001" }),
            c("f_Name", "品名", "text", { common: true, hint: "輸入品名，如 豬腳" }),
            c("f_Price", "價格（秤重品是每公斤，其餘每件）", "money", { common: true, inferred: true }),
            c("f_Kind", "分類編號", "text", { common: true }),
            c("f_Hide", "隱藏品項", "flag", { common: true }),
            c("f_LastModify", "最後修改時間", "datetime", { common: true }),
            c("f_Stop", "暫停銷售", "flag"),
        ],
    },
    {
        key: "i_foodkind",
        label: "品項分類",
        columns: [
            c("t_No", "分類編號", "text", { common: true }),
            c("t_Name", "分類名稱", "text", { common: true, hint: "輸入分類名稱，如 秤重" }),
            c("t_Hide", "隱藏分類", "flag", { common: true }),
            c("t_LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
    {
        key: "i_checkKind",
        label: "付款方式清單",
        columns: [
            c("k_ID", "代碼", "text", { common: true }),
            c("k_Name", "付款方式", "text", { common: true, hint: "輸入付款方式，如 現金" }),
            c("k_Cash", "屬於現金", "flag", { common: true }),
            c("k_Changable", "可找零", "flag", { common: true, inferred: true }),
            c("k_SeqNo", "排序", "text", { common: true }),
        ],
    },
    {
        key: "i_cashkind",
        label: "現金面額",
        columns: [
            c("C_SeqNo", "排序", "text", { common: true }),
            c("C_Name", "面額名稱", "text", { common: true }),
            c("C_CashValue", "面額", "money", { common: true }),
        ],
    },
    {
        key: "i_reason",
        label: "原因代碼",
        columns: [
            c("r_no", "代碼", "text", { common: true }),
            c("r_name", "原因", "text", { common: true, hint: "輸入原因，如 客戶不要" }),
            c("r_type", "用途", "text", {
                common: true,
                values: { "1": "作廢／刪單原因", "2": "招待原因" },
            }),
            c("r_LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
    {
        key: "i_shiftOpLog",
        label: "交班操作紀錄",
        columns: [
            c("op_time", "操作時間", "datetime", { common: true, hint: "輸入日期，如 2026-10-09" }),
            c("op_Shifttype", "操作類型", "text", {
                common: true,
                inferred: true,
                values: { Z: "日結（Z 帳）", X: "交班（X 帳）" },
            }),
            c("op_workdate", "營業日", "date", { common: true, hint: "輸入營業日，如 2026/10/09" }),
            c("op_prevShift", "前一班別", "text", { common: true }),
            c("op_NextShift", "下一班別", "text", { common: true }),
            c("op_PrevOp", "前一班人員代號", "text", { inferred: true }),
            c("op_NextOp", "下一班人員代號", "text", { inferred: true }),
        ],
    },
    {
        key: "i_ShiftCashSum",
        label: "交班現金點鈔",
        columns: [
            c("t_WorkDate", "營業日", "date", { common: true }),
            c("t_CashName", "面額名稱", "text", { common: true }),
            c("t_CashValue", "面額", "money", { common: true }),
            c("t_Total", "點鈔金額", "money", { common: true, inferred: true }),
            c("t_LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
    {
        key: "i_shiftCheckSum",
        label: "交班付款彙總",
        columns: [
            c("s_WorkDate", "營業日", "date", { common: true }),
            c("s_KindName", "付款方式", "text", { common: true }),
            c("s_Total", "金額", "money", { common: true }),
            c("s_Count1", "筆數", "number", { common: true, inferred: true }),
            c("s_LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
    {
        key: "i_timeSeg",
        label: "統計時段",
        columns: [
            c("tm_name", "時段名稱", "text", { common: true }),
            c("tm_start", "開始時間", "text", { common: true }),
            c("tm_end", "結束時間", "text", { common: true }),
        ],
    },
    {
        key: "i_seat",
        label: "座位",
        columns: [c("m_Seat", "座位代號", "text", { common: true }), c("m_LastModify", "最後修改時間", "datetime", { common: true })],
    },
    {
        key: "i_Lastshift",
        label: "日結進度",
        columns: [
            c("machine_id", "機台", "text", { common: true }),
            c("cur_workdate", "目前營業日", "date", { common: true, inferred: true }),
            c("LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
    {
        key: "i_shift",
        label: "班別",
        columns: [
            c("t_ID", "班別代號", "text", { common: true }),
            c("t_Name", "班別名稱", "text", { common: true }),
            c("t_StartTime", "開始時間", "text", { common: true }),
            c("t_EndTime", "結束時間", "text", { common: true }),
        ],
    },
    {
        key: "i_pricetime",
        label: "價格時段",
        columns: [
            c("m_id", "編號", "text", { common: true }),
            c("m_NAME", "名稱", "text", { common: true, hint: "輸入名稱，如 週末" }),
            c("m_LastModify", "最後修改時間", "datetime", { common: true }),
        ],
    },
];

const TABLE_MAP = new Map(POS_TABLE_DEFS.map((t) => [t.key, t]));

export function tableLabel(table: string): string {
    return TABLE_MAP.get(table)?.label ?? `其他（${table}）`;
}

export function getTableDef(table: string): TableDef | undefined {
    return TABLE_MAP.get(table);
}

/** 畫面上要顯示的欄位定義：未知欄位顯示「其他（原代號）」。 */
export function resolveColumn(table: string, key: string): ColumnDef {
    const def = TABLE_MAP.get(table)?.columns.find((x) => x.key === key);
    return def ?? { key, label: `其他（${key}）`, kind: "text" };
}

/** 依目前實際存在的欄位，決定要顯示哪些（all=false 只顯示常用）。保持對照表裡的順序，未知欄位排最後。 */
export function visibleColumns(table: string, actual: string[], all: boolean): ColumnDef[] {
    const def = TABLE_MAP.get(table);
    const have = new Set(actual);
    const known = (def?.columns ?? []).filter((d) => have.has(d.key));
    const knownKeys = new Set(known.map((d) => d.key));
    if (!all) {
        const common = known.filter((d) => d.common);
        // 沒有任何對照的表（廠商新增的表）：退回顯示全部，避免一片空白
        return common.length ? common : actual.map((k) => resolveColumn(table, k));
    }
    const rest = actual.filter((k) => !knownKeys.has(k)).map((k) => resolveColumn(table, k));
    return [...known, ...rest];
}

/** 可作為搜尋欄位的（只列有提示文字的常用欄位）。 */
export function searchableColumns(table: string): ColumnDef[] {
    return (TABLE_MAP.get(table)?.columns ?? []).filter((d) => d.common && d.hint);
}

// ---------------------------------------------------------------------------
// 數值顯示

const BLANK_DATETIME = /^1900-01-01/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function thousands(n: number, maxDecimals = 2): string {
    if (n === 0) return "0"; // 避免 -0
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}

export function formatCell(def: ColumnDef, raw: unknown): string {
    if (raw === null || raw === undefined) return "";
    const s = String(raw);
    if (s === "") return "";
    if (def.values && def.values[s] !== undefined) return def.values[s];

    // 任何欄位只要長得像日期時間就顯示到分鐘；1900-01-01 是 POS 的「沒有值」
    if (BLANK_DATETIME.test(s)) return "";
    const dt = DATETIME_RE.exec(s);
    if (dt && (def.kind === "datetime" || def.kind === "text")) return `${dt[1]} ${dt[2]}`;

    switch (def.kind) {
        case "flag":
            return Number(raw) === 1 ? "是" : "否";
        case "money": {
            const n = Number(raw);
            return Number.isFinite(n) ? thousands(n, 2) : s;
        }
        case "number": {
            const n = Number(raw);
            return Number.isFinite(n) ? thousands(n, 3) : s;
        }
        case "weight_kg": {
            const n = Number(raw);
            if (!Number.isFinite(n)) return s;
            return n === 0 ? "" : thousands(n / KG_PER_TAIWAN_CATTY, 3);
        }
        default:
            return s;
    }
}

/** 推斷名稱的清單（給 owner 確認用）。 */
export function inferredLabels(): Array<{ table: string; column: string; label: string }> {
    const out: Array<{ table: string; column: string; label: string }> = [];
    for (const t of POS_TABLE_DEFS) {
        for (const col of t.columns) {
            if (col.inferred) out.push({ table: t.label, column: col.key, label: col.label });
        }
    }
    return out;
}
