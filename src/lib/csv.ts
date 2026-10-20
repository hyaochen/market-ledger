/**
 * CSV 輸出共用工具。
 * - 含 , " \r \n 的欄位用雙引號包起來，內部雙引號加倍
 * - 以 = + - @ Tab CR 開頭的欄位前面補單引號，避免被 Excel 當成公式執行（CSV injection）
 *   注意：純數字（含負數）不補，否則負的金額會變成文字
 */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? "" : String(value);
    const isNumber = typeof value === "number" && Number.isFinite(value);
    if (!isNumber && FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) {
        text = `'${text}`;
    }
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function toCsv(rows: unknown[][], eol = "\r\n"): string {
    return rows.map((row) => row.map(csvCell).join(",")).join(eol);
}
