import type { Metadata, Viewport } from "next";
import { getCashUserOrNull } from "@/lib/cash-auth";
import CashShell from "@/components/cash/CashShell";

export const metadata: Metadata = {
    title: "市場現金清點",
    description: "宏記軒每日現金清點 PWA",
    manifest: "/cash-manifest.json",
    appleWebApp: {
        capable: true,
        title: "市場清點",
        statusBarStyle: "default",
    },
    other: {
        "apple-mobile-web-app-capable": "yes",
        "mobile-web-app-capable": "yes",
        "apple-mobile-web-app-status-bar-style": "default",
        "apple-mobile-web-app-title": "市場清點",
    },
    icons: {
        icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
        apple: "/apple-touch-icon.png",
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    themeColor: "#b56500",
};

/**
 * /cash 的 layout（T-ML-034）。
 *
 * /cash/login 也套這個 layout，所以不能用會 redirect 的 requireCashAuth，
 * 改用 getCashUserOrNull()：未登入只渲染 children（登入頁不顯示任何導覽），
 * 已登入才包上 App shell（標頭 + 導覽 + 登出）。
 */
export default async function CashLayout({ children }: { children: React.ReactNode }) {
    const user = await getCashUserOrNull();

    return (
        <div className="cash-app min-h-[100dvh] bg-amber-50 text-stone-900 print:bg-white">
            {user ? <CashShell user={user}>{children}</CashShell> : children}
        </div>
    );
}
