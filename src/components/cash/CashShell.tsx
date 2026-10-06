"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    ChartColumn,
    CircleUser,
    ClipboardPen,
    History,
    Settings,
    type LucideIcon,
} from "lucide-react";
import {
    activeNavKey,
    identityLine,
    navItemsFor,
    type CashNavKey,
    type CashShellUser,
} from "@/lib/cash-ui";
import { cn } from "@/lib/utils";
import CashLogo from "./CashLogo";
import CashLogoutButton from "./CashLogoutButton";

const NAV_ICONS: Record<CashNavKey, LucideIcon> = {
    entry: ClipboardPen,
    history: History,
    stats: ChartColumn,
    admin: Settings,
    account: CircleUser,
};

type Props = {
    user: CashShellUser;
    children: React.ReactNode;
};

/**
 * /cash 登入後的外框（T-ML-034 A1）。
 *
 * - 手機（< md）：頂部標頭放「現在是誰、哪個攤位」+ 登出；底部固定 tab bar（員工 3 個、管理者 5 個）
 * - 桌機（>= md）：標頭內嵌水平導覽，右側是帳號資訊 + 登出；不顯示底部 tab bar
 * - 整個外框 print:hidden，列印（歷史詳情）時不會印出標頭或導覽
 * - 清點會記到「登入者的攤位」，所以攤位名稱放在標頭最顯眼的位置，避免員工搞錯
 * - 不依賴 viewport-fit=cover：底部 tab 用 env(safe-area-inset-bottom) 做 padding，沒有安全區就是 0
 */
export default function CashShell({ user, children }: Props) {
    const pathname = usePathname() ?? "";
    const active = activeNavKey(pathname);
    const items = navItemsFor(user.isAdmin);
    const stall = user.locationName ?? "未指派攤位";
    const who = identityLine(user.displayName, user.isAdmin);

    return (
        <div className="flex min-h-[100dvh] flex-col">
            <a
                href="#cash-main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:text-base focus:font-bold focus:text-stone-900 focus:shadow-lg print:hidden"
            >
                跳到主要內容
            </a>

            <header className="sticky top-0 z-40 border-b border-stone-200 bg-white pt-safe print:hidden">
                <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4">
                    {/* 手機：左側就是「哪個攤位、誰在用」 */}
                    <Link
                        href="/cash"
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg md:hidden"
                    >
                        <CashLogo className="h-10 w-10 shrink-0" />
                        <span className="min-w-0 leading-tight">
                            <span className="block truncate text-[17px] font-bold text-stone-900">{stall}</span>
                            <span className="block truncate text-[13px] text-stone-600">{who}</span>
                        </span>
                    </Link>

                    {/* 桌機：品牌 + 水平導覽 */}
                    <Link href="/cash" className="hidden shrink-0 items-center gap-2.5 rounded-lg md:flex">
                        <CashLogo className="h-9 w-9" />
                        <span className="text-[17px] font-bold text-stone-900">市場現金清點</span>
                    </Link>
                    <nav aria-label="主要功能" className="hidden items-center gap-1 md:flex">
                        {items.map((item) => {
                            const Icon = NAV_ICONS[item.key];
                            const isActive = item.key === active;
                            return (
                                <Link
                                    key={item.key}
                                    href={item.href}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold transition-colors duration-150 motion-reduce:transition-none",
                                        isActive
                                            ? "bg-amber-100 text-amber-900"
                                            : "text-stone-700 hover:bg-stone-100",
                                    )}
                                >
                                    <Icon className="h-5 w-5" aria-hidden="true" />
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* 桌機：帳號資訊 */}
                    <div className="ml-auto hidden min-w-0 items-center gap-3 md:flex">
                        <span className="truncate rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-900">
                            {stall}
                        </span>
                        <span className="truncate text-[15px] text-stone-700">{who}</span>
                    </div>

                    <CashLogoutButton variant="header" />
                </div>
            </header>

            <main
                id="cash-main"
                className="mx-auto w-full max-w-3xl flex-1 pb-nav-safe md:pb-10 print:max-w-none print:p-0"
            >
                {children}
            </main>

            {/* 手機底部 tab bar：高 64px，另外加上底部安全區 */}
            <nav
                aria-label="主要功能"
                className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white pb-safe md:hidden print:hidden"
            >
                <ul className="mx-auto flex max-w-3xl items-stretch">
                    {items.map((item) => {
                        const Icon = NAV_ICONS[item.key];
                        const isActive = item.key === active;
                        return (
                            <li key={item.key} className="min-w-0 flex-1">
                                <Link
                                    href={item.href}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "flex h-16 flex-col items-center justify-center gap-0.5 text-[13px] font-semibold transition-colors duration-150 motion-reduce:transition-none",
                                        isActive ? "text-amber-900" : "text-stone-600 active:bg-stone-100",
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
                                            isActive ? "bg-amber-200" : "bg-transparent",
                                        )}
                                    >
                                        <Icon
                                            className="h-6 w-6"
                                            strokeWidth={isActive ? 2.5 : 2}
                                            aria-hidden="true"
                                        />
                                    </span>
                                    <span className="truncate">{item.label}</span>
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>
        </div>
    );
}
