import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { getDashboardStats } from "@/app/actions/entry";
import { formatPrice } from "@/lib/units";

// Force dynamic rendering to ensure fresh data
export const dynamic = 'force-dynamic';

export default async function Home() {
  const stats = await getDashboardStats();

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">今日概況</h1>
          <p className="text-muted-foreground text-sm">{new Date().toLocaleDateString('zh-TW', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>

      {/* 核心指標 */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-gradient-to-br from-primary/20 to-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日營收</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary flex items-baseline">
              {formatPrice(stats.revenue)}
            </div>
            <p className="text-xs text-primary/80 mt-1 flex items-center">
              <TrendingUp className="h-3 w-3 mr-1" />
              利潤: {formatPrice(stats.profit)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">今日支出</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground flex items-baseline">
              {formatPrice(stats.cost)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 近期活動 */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">系統狀態</h2>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">
              資料庫連線正常。
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
