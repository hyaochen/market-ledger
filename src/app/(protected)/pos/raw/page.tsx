import { getRawPage, listExistingTables } from "@/lib/pos-queries";
import { parsePage } from "@/lib/pos-format";
import { btnCls, fieldCls, tdCls, thCls } from "../ui";
import Pager from "../Pager";

type SP = { table?: string; col?: string; q?: string; page?: string };

function cell(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.length > 80 ? s.slice(0, 80) + "..." : s;
}

export default async function RawPage({ searchParams }: { searchParams: Promise<SP> }) {
    const sp = await searchParams;
    const tables = listExistingTables();
    const table = sp.table && tables.includes(sp.table) ? sp.table : tables[0] ?? "";
    const q = (sp.q ?? "").slice(0, 60);
    const page = parsePage(sp.page);
    const data = table ? getRawPage(table, sp.col ?? "", q, page) : null;

    return (
        <div className="space-y-4">
            {tables.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚未收到 POS 資料。</p>
            ) : (
                <form method="get" className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        資料表
                        <select name="table" defaultValue={table} className={fieldCls}>
                            {tables.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        搜尋欄位
                        <select name="col" defaultValue={data?.activeCol ?? ""} className={fieldCls}>
                            <option value="">（不篩選）</option>
                            {(data?.columns ?? []).map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="text-xs text-muted-foreground flex flex-col gap-1">
                        包含文字
                        <input type="text" name="q" defaultValue={q} className={fieldCls + " w-40"} />
                    </label>
                    <button type="submit" className={btnCls}>
                        查詢
                    </button>
                </form>
            )}
            <p className="text-xs text-muted-foreground">
                換資料表後，搜尋欄位清單要送出一次查詢才會更新。
            </p>

            {data && (
                <>
                    <div className="overflow-x-auto rounded-md border">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/50">
                                <tr>
                                    {data.columns.map((c) => (
                                        <th key={c} className={thCls}>
                                            {c}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.length === 0 && (
                                    <tr>
                                        <td
                                            colSpan={Math.max(1, data.columns.length)}
                                            className="px-2 py-6 text-center text-muted-foreground"
                                        >
                                            沒有資料
                                        </td>
                                    </tr>
                                )}
                                {data.rows.map((r, idx) => (
                                    <tr key={idx} className="border-t">
                                        {data.columns.map((c) => (
                                            <td key={c} className={tdCls}>
                                                {cell(r[c])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Pager
                        basePath="/pos/raw"
                        params={{ table, col: data.activeCol, q }}
                        page={page}
                        total={data.total}
                    />
                </>
            )}
        </div>
    );
}
