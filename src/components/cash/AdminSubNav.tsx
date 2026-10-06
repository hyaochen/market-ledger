"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SUB_ITEMS, activeAdminSubKey } from "@/lib/cash-ui";
import { cn } from "@/lib/utils";

/**
 * 管理區的頁內分段選單（T-ML-034 A1/A4）：分析 / 異常 / 動作清單。
 * 取代原本藏在 admin layout 裡、要先進到 admin 頁才看得到的底線連結。
 * 分析頁的網址仍是 /cash/stats，所以這個元件同時放在 admin layout 與 stats 頁。
 *
 * active 項目：白底浮起 + 粗體 + aria-current（不只靠顏色）。
 */
export default function AdminSubNav() {
    const pathname = usePathname() ?? "";
    const active = activeAdminSubKey(pathname);

    return (
        <nav aria-label="管理功能" className="print:hidden">
            <ul className="grid grid-cols-3 gap-1 rounded-2xl bg-stone-200/70 p-1 sm:inline-grid sm:grid-cols-[repeat(3,minmax(7rem,auto))]">
                {ADMIN_SUB_ITEMS.map((item) => {
                    const isActive = item.key === active;
                    return (
                        <li key={item.key}>
                            <Link
                                href={item.href}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "flex min-h-11 items-center justify-center rounded-xl px-3 text-[15px] transition-colors duration-150 motion-reduce:transition-none",
                                    isActive
                                        ? "bg-white font-bold text-stone-900 shadow-sm"
                                        : "font-semibold text-stone-700 hover:bg-white/60",
                                )}
                            >
                                {item.label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
