// Unit tests for the Chinese label table and cell formatting. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCell, inferredLabels, resolveColumn, searchableColumns, tableLabel, visibleColumns } from "./pos-labels";
import { POS_TABLES } from "./yjc-db";

test("every whitelisted table has a Chinese name and no code leaks into labels", () => {
    for (const t of POS_TABLES) {
        const name = tableLabel(t);
        assert.ok(!name.startsWith("其他"), `${t} has no label`);
        assert.ok(!/[a-z]_/i.test(name), `${t} label looks like a code: ${name}`);
    }
});

test("visibleColumns: default shows only common columns, all appends unknown as other(code)", () => {
    const actual = ["m_OrderNo", "m_Total", "m_Machine", "m_ZZ_new"];
    const common = visibleColumns("i_orders", actual, false).map((c) => c.label);
    assert.deepEqual(common, ["單號", "金額"]);
    const all = visibleColumns("i_orders", actual, true).map((c) => c.label);
    assert.ok(all.includes("機台"));
    assert.equal(all[all.length - 1], "其他（m_ZZ_new）");
    assert.equal(resolveColumn("i_orders", "m_unknown").label, "其他（m_unknown）");
});

test("formatCell: money, flag, weight in catty, datetime to minute, blank 1900", () => {
    assert.equal(formatCell(resolveColumn("i_orders", "m_Total"), 16453), "16,453");
    assert.equal(formatCell(resolveColumn("i_items", "p_Return"), 1), "是");
    assert.equal(formatCell(resolveColumn("i_items", "p_Return"), 0), "否");
    assert.equal(formatCell(resolveColumn("i_items", "p_Weight"), 0.124), "0.207");
    assert.equal(formatCell(resolveColumn("i_orders", "m_CloseTime"), "2026-10-09 18:26:36.000"), "2026-10-09 18:26");
    assert.equal(formatCell(resolveColumn("i_orders", "m_CloseTime"), "1900-01-01 00:00:00.000"), "");
    assert.equal(formatCell(resolveColumn("i_orders", "m_WorkDate"), "2026/10/09"), "2026/10/09");
    assert.equal(formatCell(resolveColumn("i_ShiftTotal", "z_shift"), "@"), "全日（Z 帳）");
});

test("searchable columns all carry a concrete example hint", () => {
    const cols = searchableColumns("i_orders");
    assert.ok(cols.length > 0);
    for (const c of cols) assert.match(c.hint ?? "", /輸入/);
});

test("inferred labels are listed for owner confirmation", () => {
    const list = inferredLabels();
    assert.ok(list.some((x) => x.column === "z_shift"));
});
