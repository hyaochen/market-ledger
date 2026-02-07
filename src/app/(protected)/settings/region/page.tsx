import { getRegions } from "@/app/actions/admin";
import { toggleRegionStatus, deleteRegion, toggleLocationStatus } from "@/app/actions/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Store, Trash2 } from "lucide-react";
import RegionForm from "./RegionForm";
import LocationForm from "./LocationForm";

export const dynamic = 'force-dynamic';

export default async function RegionPage() {
    const regions = await getRegions();

    return (
        <div className="space-y-6 pb-20">
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">區域與場所管理</h1>
                    <p className="text-muted-foreground text-sm">管理營業區域及其下屬場所</p>
                </div>
                <RegionForm />
            </header>

            {regions.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        尚未建立任何區域，請先新增區域。
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {regions.map((region: any) => (
                        <Card key={region.id}>
                            <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
                                <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-primary" />
                                    <CardTitle className="text-base">{region.name}</CardTitle>
                                    {region.code && (
                                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                            {region.code}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <form action={async () => {
                                        'use server';
                                        await toggleRegionStatus(region.id, !region.isActive);
                                    }}>
                                        <Button variant="outline" size="sm" className="text-xs h-7">
                                            {region.isActive ? '停用' : '啟用'}
                                        </Button>
                                    </form>
                                    <form action={async () => {
                                        'use server';
                                        await deleteRegion(region.id);
                                    }}>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </form>
                                </div>
                            </CardHeader>
                            <CardContent className="px-4 pb-4 pt-0">
                                <div className="space-y-2">
                                    {region.locations.length === 0 ? (
                                        <div className="text-sm text-muted-foreground py-2 pl-6">尚無場所</div>
                                    ) : (
                                        region.locations.map((loc: any) => (
                                            <div key={loc.id} className="flex items-center justify-between pl-6 py-1.5 hover:bg-muted/50 rounded">
                                                <div className="flex items-center gap-2">
                                                    <Store className="h-3.5 w-3.5 text-muted-foreground" />
                                                    <span className="text-sm">{loc.name}</span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                                        loc.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                    }`}>
                                                        {loc.isActive ? '啟用' : '停用'}
                                                    </span>
                                                </div>
                                                <form action={async () => {
                                                    'use server';
                                                    await toggleLocationStatus(loc.id, !loc.isActive);
                                                }}>
                                                    <Button variant="ghost" size="sm" className="text-xs h-7">
                                                        {loc.isActive ? '停用' : '啟用'}
                                                    </Button>
                                                </form>
                                            </div>
                                        ))
                                    )}
                                    <div className="pl-6 pt-1">
                                        <LocationForm regionId={region.id} regionName={region.name} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
