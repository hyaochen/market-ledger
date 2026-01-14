import { getRegions } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import RegionForm from "./RegionForm";

export default async function RegionPage() {
    const regions = await getRegions();

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">區域管理</h1>
                    <p className="text-muted-foreground text-sm">維護行政區域資料</p>
                </div>
                <RegionForm regions={regions} />
            </header>

            <Card>
                <CardContent className="p-0">
                    <div className="divide-y">
                        {regions.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">尚未定義任何區域資料</div>
                        ) : (
                            regions.map((region: any) => (
                                <div key={region.id} className="flex items-center justify-between p-4 hover:bg-muted/50">
                                    <div className="flex items-center gap-3">
                                        <MapPin className="h-4 w-4 text-primary" />
                                        <div>
                                            <div className="font-semibold">{region.name}</div>
                                            <div className="text-xs text-muted-foreground">代碼: {region.code} | 類型: {region.type}</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
