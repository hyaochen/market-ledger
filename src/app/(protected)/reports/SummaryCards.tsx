import { Card, CardContent } from "@/components/ui/card";
import { formatPrice } from "@/lib/units";
import { type ReportsClientProps } from "./reports-types";

export function SummaryCards({ totals }: { totals: ReportsClientProps["totals"] }) {
    return (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Card className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 to-transparent" />
                <CardContent className="p-4 relative">
                    <p className="text-xs text-muted-foreground mb-1">總營收</p>
                    <p className="text-lg sm:text-2xl font-bold text-sky-600">{formatPrice(totals.revenue)}</p>
                </CardContent>
            </Card>
            <Card className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent" />
                <CardContent className="p-4 relative">
                    <p className="text-xs text-muted-foreground mb-1">總成本</p>
                    <p className="text-lg sm:text-2xl font-bold text-orange-600">{formatPrice(totals.cost)}</p>
                </CardContent>
            </Card>
            <Card className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent" />
                <CardContent className="p-4 relative">
                    <p className="text-xs text-muted-foreground mb-1">預估獲利</p>
                    <p className={`text-lg sm:text-2xl font-bold ${totals.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {formatPrice(totals.profit)}
                    </p>
                </CardContent>
            </Card>
            <Card className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent" />
                <CardContent className="p-4 relative">
                    <p className="text-xs text-muted-foreground mb-1">
                        日均營業額 <span className="opacity-70">(不含休假)</span>
                    </p>
                    <p className="text-lg sm:text-2xl font-bold text-indigo-600">{formatPrice(totals.avgDailyRevenue)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">分母 {totals.businessDayCount} 個營業日</p>
                </CardContent>
            </Card>
        </div>
    );
}
