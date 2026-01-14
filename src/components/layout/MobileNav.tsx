"use client";

import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ShoppingCart, DollarSign, Settings, PlusCircle, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function MobileNav({ role }: { role: string }) {
    const pathname = usePathname();
    const router = useRouter();

    const navItems = [
        { icon: LayoutDashboard, label: '首頁', href: '/' },
        { icon: ShoppingCart, label: '進貨', href: '/inventory' },
        { icon: PlusCircle, label: '記帳', href: '/entry/new', prominent: true },
        { icon: DollarSign, label: '營收', href: '/revenue' },
        { icon: BarChart3, label: '報表', href: '/reports' },
        { icon: Settings, label: '設定', href: '/settings', requireAdmin: true },
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/80 backdrop-blur-lg pb-safe">
            <div className="flex items-center justify-around h-16 px-2">
                {navItems.map((item) => {
                    if (item.requireAdmin && role !== 'admin') return null;
                    const isActive = pathname === item.href;
                    if (item.prominent) {
                        return (
                            <div key={item.href} className="-mt-8">
                                <Button
                                    size="icon"
                                    className="h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90"
                                    onClick={() => router.push(item.href)}
                                >
                                    <item.icon className="h-6 w-6 text-primary-foreground" />
                                </Button>
                            </div>
                        );
                    }
                    return (
                        <button
                            key={item.href}
                            onClick={() => router.push(item.href)}
                            className={cn(
                                "flex flex-col items-center justify-center w-full h-full space-y-1",
                                isActive ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            <item.icon className="h-5 w-5" />
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
