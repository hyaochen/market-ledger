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

type LocationOpt = { id: string; name: string };
type RevenueFormState = { amount: string; isDayOff: boolean };

type Props = {
    locations: LocationOpt[];
};

export default function RevenueForm({ locations }: Props) {
    const { toast } = useToast();
    const [date, setDate] = useState(formatDateInput(new Date()));
    const [loading, setLoading] = useState<string | null>(null);

    const [forms, setForms] = useState<Record<string, RevenueFormState>>(() => {
        const initial: Record<string, RevenueFormState> = {};
        if (locations) {
            locations.forEach(loc => {
                initial[loc.id] = { amount: "", isDayOff: false };
            });
        }
        return initial;
    });

    const handleAmountChange = (locId: string, value: string) => {
        setForms(prev => ({
            ...prev,
            [locId]: { ...prev[locId], amount: value }
        }));
    };

    const handleDayOffToggle = (locId: string, checked: boolean) => {
        setForms(prev => ({
            ...prev,
            [locId]: {
                amount: checked ? "0" : "",
                isDayOff: checked,
            }
        }));
    };

    const handleSubmit = async (locId: string) => {
        const data = forms[locId];
        const trimmed = data.amount.trim();
        const amount = trimmed === "" ? NaN : parseFloat(trimmed);

        // 沒勾休假但金額空或 0 → 擋下（防止髒資料：員工以為休假就直接送 0）
        if (!data.isDayOff) {
            if (!Number.isFinite(amount) || amount <= 0) {
                toast({
                    title: "請填寫正確金額",
                    description: "若是休假請勾選「今日休假」；若有營業請填正確金額。",
                    variant: "destructive",
                });
                return;
            }
        }

        const finalAmount = data.isDayOff ? 0 : amount;

        setLoading(locId);
        const result = await recordRevenue(date, locId, finalAmount, data.isDayOff);
        setLoading(null);

        if (result.success) {
            toast({ title: "成功", description: data.isDayOff ? "已記錄為休假日" : "營收已記錄" });
        } else {
            toast({ title: "失敗", description: result.error ?? "儲存失敗", variant: "destructive" });
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

                {locations.map(loc => {
                    const form = forms[loc.id] ?? { amount: "", isDayOff: false };
                    return (
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
                                            placeholder={form.isDayOff ? "休假" : "請填金額"}
                                            className="text-lg font-bold"
                                            value={form.amount}
                                            disabled={form.isDayOff}
                                            onChange={(e) => handleAmountChange(loc.id, e.target.value)}
                                        />
                                        {!form.isDayOff && (
                                            <p className="text-xs text-muted-foreground">
                                                若今日休假請勾選下方「今日休假」；金額不能為 0。
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id={`dayoff-${loc.id}`}
                                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            checked={form.isDayOff}
                                            onChange={(e) => handleDayOffToggle(loc.id, e.target.checked)}
                                        />
                                        <Label htmlFor={`dayoff-${loc.id}`}>☑ 今日休假（金額將記為 0、不列入平均日營業額）</Label>
                                    </div>
                                    <Button
                                        className="w-full"
                                        disabled={loading === loc.id}
                                        onClick={() => handleSubmit(loc.id)}
                                    >
                                        {loading === loc.id ? "儲存中..." : form.isDayOff ? "儲存休假紀錄" : "儲存記錄"}
                                    </Button>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    );
                })}
            </Tabs>
        </div>
    );
}
