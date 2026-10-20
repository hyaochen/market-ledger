import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv";

test("一般文字原樣輸出", () => {
    assert.equal(csvCell("滷豬耳"), "滷豬耳");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
});

test("逗號、雙引號、換行會被引號包起來", () => {
    assert.equal(csvCell("甲,乙"), '"甲,乙"');
    assert.equal(csvCell('他說"好"'), '"他說""好"""');
    assert.equal(csvCell("第一行\n第二行"), '"第一行\n第二行"');
    assert.equal(csvCell("第一行\r第二行"), '"第一行\r第二行"');
});

test("公式開頭的文字補單引號", () => {
    assert.equal(csvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
    assert.equal(csvCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
    assert.equal(csvCell("-2+3"), "'-2+3");
    assert.equal(csvCell("@SUM(1)"), "'@SUM(1)");
    assert.equal(csvCell("\t=1"), "'\t=1");
    assert.equal(csvCell('=HYPERLINK("http://x","點我")'), '"\'=HYPERLINK(""http://x"",""點我"")"');
});

test("數字與負數字串不被當成公式", () => {
    assert.equal(csvCell(-120), "-120");
    assert.equal(csvCell("-120"), "-120");
    assert.equal(csvCell(35.5), "35.5");
});

test("toCsv 以 CRLF 串接列", () => {
    assert.equal(toCsv([["日期", "備註"], ["2026-01-01", "=1+1"]]), "日期,備註\r\n2026-01-01,'=1+1");
});
