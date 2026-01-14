"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon } from "lucide-react";
import { recordRevenue } from "@/app/actions/revenue";
import { formatDateInput } from "@/lib/date";
import { useToast } from "@/components/ui/use-toast";

type Props = {
    locations: any[];
    initialData?: any[];
};

export default function RevenueForm({ locations }: Props) {
    const { toast } = useToast();
    const [date, setDate] = useState(formatDateInput(new Date()));
    const [loading, setLoading] = useState(false);

    // 每個地點的狀態
    const [forms, setForms] = useState<Record<string, { amount: string, isDayOff: boolean }>>(() => {
        const initial: any = {};
        if (locations) {
            locations.forEach(loc => {
                initial[loc.id] = { amount: "", isDayOff: false };
            });
        }
        return initial;
    });

    const handleInputChange = (locId: string, field: string, value: any) => {
        setForms(prev => ({
            ...prev,
            [locId]: {
                ...prev[locId],
                [field]: value
            }
        }));
    };

    const handleSubmit = async (locId: string) => {
        const data = forms[locId];
        const amount = data.amount ? parseFloat(data.amount) : 0;
        const isDayOff = data.isDayOff || !data.amount;

        setLoading(true);
        const result = await recordRevenue(date, locId, amount, isDayOff);
        setLoading(false);

        if (result.success) {
            toast({ title: "成功", description: isDayOff ? "已記錄休假" : "營收已記錄" });
        } else {
            toast({ title: "失敗", description: "儲存失敗", variant: "destructive" });
        }
    };

    return (
        <div className="space-y-6 pb-20 animate-in fade-in zoom-in duration-500">
            <div className="flex items-center space-x-2 bg-muted/50 p-2 rounded-lg">
                <CalendarIcon className="h-5 w-5 text-muted-foreground" />
                <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-auto py-1"
                />
            </div>

            <Tabs defaultValue={locations[0]?.id} className="w-full">
                <TabsList className="grid w-full mb-4" style={{ gridTemplateColumns: `repeat(${locations.length}, minmax(0, 1fr))` }}>
                    {locations.map(loc => (
                        <TabsTrigger key={loc.id} value={loc.id}>{loc.name}</TabsTrigger>
                    ))}
                </TabsList>

                {locations.map(loc => (
                    <TabsContent key={loc.id} value={loc.id} className="space-y-4">
                        <Card className="border-primary/20">
                            <CardHeader>
                                <CardTitle>{loc.name} - 營業額</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>今日收入 (TWD)</Label>
                                    <Input
                                        type="number"
                                        placeholder="0"
                                        className="text-lg font-bold"
                                        value={forms[loc.id]?.amount || ''}
                                        disabled={forms[loc.id]?.isDayOff}
                                        onChange={(e) => handleInputChange(loc.id, 'amount', e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">未填金額會視為休假。</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id={`dayoff-${loc.id}`}
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        checked={forms[loc.id]?.isDayOff || false}
                                        onChange={(e) => handleInputChange(loc.id, 'isDayOff', e.target.checked)}
                                    />
                                    <Label htmlFor={`dayoff-${loc.id}`}>今日公休</Label>
                                </div>
                                <Button className="w-full" disabled={loading} onClick={() => handleSubmit(loc.id)}>
                                    {loading ? "儲存中..." : "儲存記錄"}
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
