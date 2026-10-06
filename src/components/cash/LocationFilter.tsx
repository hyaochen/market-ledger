import Link from "next/link";
import { Check } from "lucide-react";
import { hrefWithParams } from "@/lib/cash-ui";
import { cn } from "@/lib/utils";

type Props = {
    basePath: string;
    /** 目前網址上的其他參數（例如 from / to），切換攤位時會保留 */
    params: Record<string, string | undefined>;
    locations: { id: string; name: string }[];
    /** 目前選中的攤位 id；沒有 = 全部 */
    selectedId?: string;
};

/**
 * 管理者的攤位篩選（T-ML-034 C2）：「全部」+ 各攤位。
 * 用一般連結實作（URL 參數 ?loc=<locationId>），不需要 JS，也能直接分享/重新整理。
 * 選中的項目：實心底色 + 勾號 + aria-current，不只靠顏色。
 * 攤位清單由呼叫端從資料庫取（該租戶、啟用中的 Location），這裡不寫死任何名稱。
 * 只有一個攤位時沒有篩選的意義，直接不顯示。
 */
export default function LocationFilter({ basePath, params, locations, selectedId }: Props) {
    if (locations.length < 2) return null;
    const items: { id: string | undefined; name: string }[] = [{ id: undefined, name: "全部" }, ...locations];

    return (
        <nav aria-label="依攤位篩選" className="flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
            <span className="text-[15px] font-bold text-stone-900">攤位</span>
            <ul className="flex flex-wrap gap-2">
                {items.map((l) => {
                    const active = l.id === selectedId;
                    return (
                        <li key={l.id ?? "all"}>
                            <Link
                                href={hrefWithParams(basePath, params, { loc: l.id })}
                                aria-current={active ? "true" : undefined}
                                className={cn(
                                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-bold transition-colors duration-150 motion-reduce:transition-none",
                                    active
                                        ? "border-amber-700 bg-amber-700 text-white"
                                        : "border-stone-300 bg-white text-stone-900 hover:bg-stone-100 active:bg-stone-200",
                                )}
                            >
                                {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                                {l.name}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
