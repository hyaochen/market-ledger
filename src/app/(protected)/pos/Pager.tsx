import Link from "next/link";
import { PAGE_SIZE } from "@/lib/pos-queries";
import { buildQuery } from "@/lib/pos-format";

export default function Pager({
    basePath,
    params,
    page,
    total,
}: {
    basePath: string;
    params: Record<string, string | undefined>;
    page: number;
    total: number;
}) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const link = (p: number) => `${basePath}${buildQuery({ ...params, page: p })}`;
    const cls = "px-3 py-1.5 text-sm border rounded-md";
    return (
        <div className="flex items-center justify-between gap-2 pt-3 text-sm">
            <div>
                {page > 1 ? (
                    <Link href={link(page - 1)} className={cls}>
                        上一頁
                    </Link>
                ) : (
                    <span className={cls + " opacity-40"}>上一頁</span>
                )}
            </div>
            <div className="text-muted-foreground">
                第 {page} / {pages} 頁，共 {total.toLocaleString("en-US")} 筆
            </div>
            <div>
                {page < pages ? (
                    <Link href={link(page + 1)} className={cls}>
                        下一頁
                    </Link>
                ) : (
                    <span className={cls + " opacity-40"}>下一頁</span>
                )}
            </div>
        </div>
    );
}
