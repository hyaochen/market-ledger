import type { Metadata, Viewport } from "next";
import Link from "next/link";

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

export default function CashLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-[100dvh] bg-amber-50 text-zinc-900 flex flex-col">
            <header className="sticky top-0 z-30 bg-amber-700 text-white shadow-sm pt-safe">
                <div className="px-4 py-2 flex items-center justify-between max-w-3xl mx-auto w-full">
                    <Link href="/cash" className="text-base font-bold tracking-wider">
                        🪙 市場現金清點
                    </Link>
                    <nav className="text-xs flex gap-3">
                        <Link href="/cash" className="hover:underline">新增</Link>
                        <Link href="/cash/history" className="hover:underline">歷史</Link>
                    </nav>
                </div>
            </header>
            <main className="flex-1 w-full max-w-3xl mx-auto pb-nav-safe">{children}</main>
        </div>
    );
}
