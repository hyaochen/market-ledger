import { getRawPage, listExistingTables } from "@/lib/pos-queries";
import { requirePosAccess } from "@/lib/pos-access";
import { listTableColumns } from "@/lib/yjc-db";
import { formatCell, getTableDef, searchableColumns, tableLabel, visibleColumns } from "@/lib/pos-labels";
import { parsePage } from "@/lib/pos-format";
import { tdCls, thCls } from "../ui";
import Pager from "../Pager";
import RawForm, { type RawTableOption } from "./RawForm";

type SP = { table?: string; col?: string; q?: string; page?: string; all?: string };

export default async function RawPage({ searchParams }: { searchParams: Promise<SP> }) {
    await requirePosAccess();
    const sp = await searchParams;
    const tables = listExistingTables();
    const table = sp.table && tables.includes(sp.table) ? sp.table : tables[0] ?? "";
    const q = (sp.q ?? "").slice(0, 60);
    const page = parsePage(sp.page);
    const showAll = sp.all === "1";

    if (tables.length === 0) {
        return <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>;
    }

    const options: RawTableOption[] = tables.map((t) => {
        const actual = new Set(listTableColumns(t));
        return {
            key: t,
            label: tableLabel(t),
            columns: searchableColumns(t)
                .filter((c) => actual.has(c.key))
                .map((c) => ({ key: c.key, label: c.label, hint: c.hint ?? "" })),
        };
    });
    const data = getRawPage(table, sp.col ?? "", q, page);
    const cols = data ? visibleColumns(table, data.columns, showAll) : [];
    const hasInferred = cols.some((c) => c.inferred);

    return (
        <div className="space-y-4">
            <RawForm
                key={`${table}|${data?.activeCol ?? ""}`}
                tables={options}
                initialTable={table}
                initialCol={data?.activeCol ?? ""}
                initialQ={q}
                initialAll={showAll}
            />
            <p className="text-xs text-muted-foreground">
                目前看的是「{tableLabel(table)}」。預設只顯示常用欄位；勾「顯示全部欄位」會多出沒有中文名稱的欄位，標成「其他（原代號）」。
                {hasInferred ? "標題帶「*」的名稱是依資料推測的。" : ""}
            </p>

            {data && (
                <>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                                <tr>
                                    {cols.map((c) => (
                                        <th key={c.key} className={thCls}>
                                            {c.label}
                                            {c.inferred ? " *" : ""}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={Math.max(1, cols.length)}
                                            className="px-2 py-6 text-center text-muted-foreground"
                                        >
                                            沒有資料
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((r, idx) => (
                                    <tr key={idx} className="border-t">
                                        {cols.map((c) => {
                                            const txt = formatCell(c, r[c.key]);
                                            const numeric = c.kind === "money" || c.kind === "number" || c.kind === "weight_kg";
                                            return (
                                                <td key={c.key} className={tdCls + (numeric ? " text-right tabular-nums" : "")}>
                                                    {txt.length > 80 ? txt.slice(0, 80) + "..." : txt}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager
                        basePath="/pos/raw"
                        params={{ table, col: data.activeCol, q, all: showAll ? "1" : undefined }}
                        page={page}
                        total={data.total}
                    />
                </>
            )}
            {!getTableDef(table) && <p className="text-xs text-muted-foreground">這張表是廠商新增的，還沒有中文對照。</p>}
        </div>
    );
}
