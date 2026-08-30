"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon } from "lucide-react";
import { recordRevenue, getFixedExpensePreview } from "@/app/actions/revenue";
import { formatDateInput } from "@/lib/date";
import { useToast } from "@/components/ui/use-toast";

type LocationOpt = { id: string; name: string };
type RevenueFormState = { amount: string; isDayOff: boolean };

// 對應 src/lib/fixedExpenseAutofill.ts 的 FixedExpensePreviewItem，前端只取需要的欄位
type FixedItemState = {
    expenseType: string;
    expenseLabel: string;
    amount: string; // 使用者可編輯，字串方便綁 input
    alreadyExists: boolean;
    existingAmount: number | null;
    enabled: boolean; // 使用者可取消勾選（= 這次不代入）
};

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

    // T-ML-027 範圍 A：自動帶固定支出 — 每個地點各自一份可預覽/可改/可關的清單
    // null = 這個地點/租戶不適用（例如 demo 租戶沒設清潔費/洗攤類型），不顯示區塊
    const [fixedItems, setFixedItems] = useState<Record<string, FixedItemState[] | null>>({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const entries = await Promise.all(
                locations.map(async (loc) => {
                    const preview = await getFixedExpensePreview(date, loc.id);
                    if (!preview) return [loc.id, null] as const;
                    const items: FixedItemState[] = preview.items.map((it) => ({
                        expenseType: it.expenseType,
                        expenseLabel: it.expenseLabel,
                        amount: String(it.amount),
                        alreadyExists: it.alreadyExists,
                        existingAmount: it.existingAmount,
                        enabled: !it.alreadyExists, // 已存在的預設不重複勾選
                    }));
                    return [loc.id, items] as const;
                })
            );
            if (cancelled) return;
            setFixedItems(Object.fromEntries(entries));
        })();
        return () => {
            cancelled = true;
        };
    }, [date, locations]);

    const updateFixedItem = (locId: string, expenseType: string, patch: Partial<FixedItemState>) => {
        setFixedItems((prev) => {
            const current = prev[locId];
            if (!current) return prev;
            return {
                ...prev,
                [locId]: current.map((it) => (it.expenseType === expenseType ? { ...it, ...patch } : it)),
            };
        });
    };

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

        // 使用者勾選 + 編輯過的固定支出項目（休假日一律不帶）
        const fixedToSend = data.isDayOff
            ? []
            : (fixedItems[locId] ?? [])
                  .filter((it) => it.enabled && !it.alreadyExists)
                  .map((it) => ({
                      expenseType: it.expenseType,
                      expenseLabel: it.expenseLabel as "清潔費" | "洗攤",
                      amount: Number(it.amount) || 0,
                  }))
                  .filter((it) => it.amount > 0);

        setLoading(locId);
        const result = await recordRevenue(date, locId, finalAmount, data.isDayOff, fixedToSend);
        setLoading(null);

        if (result.success) {
            const created = result.fixedExpenseResult?.created ?? [];
            const fixedDesc = created.length > 0
                ? `；已自動帶入：${created.map((c) => `${c.expenseLabel} $${c.amount}`).join("、")}`
                : "";
            toast({
                title: "成功",
                description: (data.isDayOff ? "已記錄為休假日" : "營收已記錄") + fixedDesc,
            });
            // 重新抓一次預覽，讓已寫入的項目立刻反映「已存在」狀態
            const preview = await getFixedExpensePreview(date, locId);
            if (preview) {
                setFixedItems((prev) => ({
                    ...prev,
                    [locId]: preview.items.map((it) => ({
                        expenseType: it.expenseType,
                        expenseLabel: it.expenseLabel,
                        amount: String(it.amount),
                        alreadyExists: it.alreadyExists,
                        existingAmount: it.existingAmount,
                        enabled: !it.alreadyExists,
                    })),
                }));
            }
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

                                    {!form.isDayOff && fixedItems[loc.id] && fixedItems[loc.id]!.length > 0 && (
                                        <div className="rounded-md border border-dashed border-primary/40 bg-muted/30 p-3 space-y-2">
                                            <p className="text-xs font-semibold text-muted-foreground">
                                                🧾 將自動帶入固定支出（可取消勾選、可改金額）
                                            </p>
                                            {fixedItems[loc.id]!.map((item) => (
                                                <div key={item.expenseType} className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-40"
                                                        checked={item.enabled}
                                                        disabled={item.alreadyExists}
                                                        onChange={(e) =>
                                                            updateFixedItem(loc.id, item.expenseType, { enabled: e.target.checked })
                                                        }
                                                    />
                                                    <span className="text-sm w-16 shrink-0">{item.expenseLabel}</span>
                                                    {item.alreadyExists ? (
                                                        <span className="text-xs text-muted-foreground">
                                                            已有記錄 NT$ {item.existingAmount}（略過，不重複建立）
                                                        </span>
                                                    ) : (
                                                        <Input
                                                            type="number"
                                                            className="h-8 w-28 text-sm"
                                                            value={item.amount}
                                                            disabled={!item.enabled}
                                                            onChange={(e) =>
                                                                updateFixedItem(loc.id, item.expenseType, { amount: e.target.value })
                                                            }
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

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
