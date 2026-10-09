"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
    { href: "/pos/daily", label: "每日營收" },
    { href: "/pos/orders", label: "單據查詢" },
    { href: "/pos/items", label: "品項排行" },
    { href: "/pos/raw", label: "原始資料" },
];

export default function PosSubNav() {
    const pathname = usePathname();
    return (
        <nav className="flex gap-1 overflow-x-auto border-b -mx-1 px-1" aria-label="POS 資料">
            {TABS.map((t) => {
                const active = pathname === t.href || pathname.startsWith(t.href + "/");
                return (
                    <Link
                        key={t.href}
                        href={t.href}
                        className={cn(
                            "whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px",
                            active
                                ? "border-primary text-primary font-semibold"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t.label}
                    </Link>
                );
            })}
        </nav>
    );
}
