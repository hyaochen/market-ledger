"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { PackagePlus, Store, ClipboardList, BookTemplate, Save, Trash2, RotateCcw } from "lucide-react";
import { convertToKg, formatPrice, type UnitDef } from "@/lib/units";
import { formatDateInput } from "@/lib/date";
import { createEntry } from "@/app/actions/entry";
import { createExpenseType, createItem, createVendor } from "@/app/actions/catalog";
import { createTemplate, deleteTemplate } from "@/app/actions/template";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";

type Props = {
    categories: any[];
    items: any[];
    vendors: any[];
    expenseTypes: any[];
    units: UnitDef[];
    templates: any[];
};

export default function EntryForm({ categories, items, vendors, expenseTypes, units, templates: initialTemplates }: Props) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const [templates, setTemplates] = useState(initialTemplates);
    const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState("");
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

    const [itemOptions, setItemOptions] = useState(items);
    const [vendorOptions, setVendorOptions] = useState(vendors);
    const [expenseOptions, setExpenseOptions] = useState(expenseTypes);

    const [date, setDate] = useState(formatDateInput(new Date()));

    // 表單狀態
    const [type, setType] = useState<'PURCHASE' | 'EXPENSE'>('PURCHASE');

    // 進貨相關
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [selectedItem, setSelectedItem] = useState<string>("");
    const [selectedVendor, setSelectedVendor] = useState<string>("");
    const [weight, setWeight] = useState<string>("");
    const [unit, setUnit] = useState<string>(units[0]?.code || "kg");
    const [price, setPrice] = useState<string>("");
    const [purchaseNote, setPurchaseNote] = useState<string>("");

    // 支出相關
    const [selectedExpenseType, setSelectedExpenseType] = useState<string>("");
    const [amount, setAmount] = useState<string>("");
    const [expenseNote, setExpenseNote] = useState<string>("");

    // 計算結果
    const [summary, setSummary] = useState<string>("");

    // 快速新增狀態
    const [itemDialogOpen, setItemDialogOpen] = useState(false);
    const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
    const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);

    const [newItemName, setNewItemName] = useState("");
    const [newItemUnit, setNewItemUnit] = useState(units[0]?.code || "kg");

    const [newVendorName, setNewVendorName] = useState("");
    const [newVendorContact, setNewVendorContact] = useState("");
    const [newVendorPhone, setNewVendorPhone] = useState("");

    const [newExpenseLabel, setNewExpenseLabel] = useState("");

    const availableItems = useMemo(() => {
        return itemOptions.filter((item) => item.categoryId === selectedCategory && item.isActive !== false);
    }, [itemOptions, selectedCategory]);

    const availableVendors = useMemo(() => {
        return vendorOptions.filter((vendor) => vendor.isActive !== false);
    }, [vendorOptions]);

    useEffect(() => {
        const item = itemOptions.find((option) => option.id === selectedItem);
        if (item?.defaultUnit) {
            setUnit(item.defaultUnit);
        }
    }, [itemOptions, selectedItem]);

    // 自動計算摘要
    useEffect(() => {
        if (!weight || !price) {
            setSummary("");
            return;
        }
        const numWeight = Number.parseFloat(weight);
        const numPrice = Number.parseFloat(price);
        if (!Number.isFinite(numWeight) || numWeight <= 0 || !Number.isFinite(numPrice)) {
            setSummary("");
            return;
        }
        const kg = convertToKg(numWeight, unit, units);
        const unitLabel = units.find((u) => u.code === unit)?.name || unit;
        if (kg !== null) {
            setSummary(`約 ${kg.toFixed(2)} 公斤`);
        } else {
            setSummary(`每${unitLabel} 約 ${formatPrice(numPrice / numWeight)}`);
        }
    }, [weight, unit, price, units]);

    const handleCreateItem = async () => {
        if (!selectedCategory) {
            toast({ title: "請先選擇類別", description: "新增品項前需要先選擇類別", variant: "destructive" });
            return;
        }
        const formData = new FormData();
        formData.append('name', newItemName);
        formData.append('categoryId', selectedCategory);
        formData.append('defaultUnit', newItemUnit);
        const result = await createItem(formData);
        if (result.success && result.item) {
            setItemOptions((prev) => (prev.some((item) => item.id === result.item.id) ? prev : [...prev, result.item]));
            setSelectedItem(result.item.id);
            setItemDialogOpen(false);
            setNewItemName("");
        } else {
            toast({ title: "新增失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleCreateVendor = async () => {
        const formData = new FormData();
        formData.append('name', newVendorName);
        formData.append('contact', newVendorContact);
        formData.append('phone', newVendorPhone);
        const result = await createVendor(formData);
        if (result.success && result.vendor) {
            setVendorOptions((prev) => (prev.some((vendor) => vendor.id === result.vendor.id) ? prev : [...prev, result.vendor]));
            setSelectedVendor(result.vendor.id);
            setVendorDialogOpen(false);
            setNewVendorName("");
            setNewVendorContact("");
            setNewVendorPhone("");
        } else {
            toast({ title: "新增失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleCreateExpenseType = async () => {
        const formData = new FormData();
        formData.append('label', newExpenseLabel);
        const result = await createExpenseType(formData);
        if (result.success && result.expenseType) {
            setExpenseOptions((prev) => (prev.some((item) => item.value === result.expenseType.value) ? prev : [...prev, result.expenseType]));
            setSelectedExpenseType(result.expenseType.value);
            setExpenseDialogOpen(false);
            setNewExpenseLabel("");
        } else {
            toast({ title: "新增失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleSaveTemplate = async () => {
        if (!newTemplateName) {
            toast({ title: "請輸入模板名稱", variant: "destructive" });
            return;
        }

        const formData = new FormData();
        formData.append('name', newTemplateName);
        formData.append('type', type);

        if (type === 'PURCHASE') {
            if (!selectedItem) {
                toast({ title: "請選擇品項", variant: "destructive" });
                return;
            }
            formData.append('itemId', selectedItem);
            formData.append('vendorId', selectedVendor || 'none');
            formData.append('weight', weight);
            formData.append('unit', unit);
            formData.append('price', price);
            formData.append('note', purchaseNote);
        } else {
            if (!selectedExpenseType) {
                toast({ title: "請選擇支出項目", variant: "destructive" });
                return;
            }
            formData.append('expenseType', selectedExpenseType);
            formData.append('amount', amount);
            formData.append('note', expenseNote);
        }

        setLoading(true);
        const result = await createTemplate(formData);

        if (result.success) {
            toast({ title: "已儲存常用記錄", description: "下次可直接從清單選取" });
            setSaveTemplateOpen(false);
            setNewTemplateName("");
            router.refresh();
        } else {
            toast({ title: "儲存失敗", description: result.message, variant: "destructive" });
        }
        setLoading(false);
    };

    const handleLoadTemplate = (template: any) => {
        setType(template.type as 'PURCHASE' | 'EXPENSE');
        if (template.type === 'PURCHASE') {
            if (template.itemId) {
                const item = itemOptions.find(i => i.id === template.itemId);
                if (item) setSelectedCategory(item.categoryId);
                setSelectedItem(template.itemId);
            }
            if (template.vendorId) setSelectedVendor(template.vendorId);
            if (template.inputQuantity) setWeight(template.inputQuantity.toString());
            if (template.inputUnit) setUnit(template.inputUnit);
            if (template.totalPrice) setPrice(template.totalPrice.toString());
            if (template.note) setPurchaseNote(template.note);
        } else {
            if (template.expenseType) setSelectedExpenseType(template.expenseType);
            if (template.totalPrice) setAmount(template.totalPrice.toString());
            if (template.note) setExpenseNote(template.note);
        }
        setTemplateDialogOpen(false);
        toast({ title: "已載入設定", description: `已套用 ${template.name}` });
    };

    const handleDeleteTemplate = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('確定要刪除這個常用記錄嗎？')) return;

        const result = await deleteTemplate(id);
        if (result.success) {
            toast({ title: "已刪除" });
            router.refresh();
        } else {
            toast({ title: "刪除失敗", description: result.message, variant: "destructive" });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData();
        formData.append('type', type);
        formData.append('date', date);

        if (type === 'PURCHASE') {
            if (!selectedItem || !weight || !price) {
                toast({ title: "錯誤", description: "請填寫完整資訊", variant: "destructive" });
                setLoading(false);
                return;
            }
            formData.append('itemId', selectedItem);
            formData.append('vendorId', selectedVendor || 'none');
            formData.append('weight', weight);
            formData.append('unit', unit);
            formData.append('price', price);
            formData.append('note', purchaseNote);
        } else {
            if (!selectedExpenseType || !amount) {
                toast({ title: "錯誤", description: "請填寫完整資訊", variant: "destructive" });
                setLoading(false);
                return;
            }
            formData.append('expenseType', selectedExpenseType);
            formData.append('amount', amount);
            formData.append('note', expenseNote);
        }

        try {
            const result = await createEntry(null, formData);
            if (result.success) {
                toast({ title: "成功", description: "記錄已儲存" });
                if (type === "PURCHASE") {
                    setWeight("");
                    setPrice("");
                    setPurchaseNote("");
                } else {
                    setAmount("");
                    setExpenseNote("");
                }
                router.refresh();
            } else {
                toast({ title: "失敗", description: result.message, variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "錯誤", description: "系統發生錯誤", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const currentTemplates = templates.filter((t: any) => t.type === type);

    return (
        <div className="space-y-6 pb-20 animate-in slide-in-from-bottom-5 duration-500">
            <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-4 text-sm text-muted-foreground space-y-2">
                    <p className="font-medium text-foreground">小提醒</p>
                    <p>先選類別與品項，再輸入數量與金額。沒有品項或廠商時，可直接按「新增」。</p>
                    <p>若未填必要欄位，系統會提醒你補填。</p>
                </CardContent>
            </Card>

            {/* 功能列 */}
            <div className="flex justify-between items-center gap-2">
                <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                    <DialogTrigger asChild>
                        <Button variant="secondary" className="gap-2 flex-1">
                            <BookTemplate className="h-4 w-4" />
                            常用記錄
                            <Badge variant="secondary" className="bg-background/80 text-foreground ml-1">
                                {currentTemplates.length}
                            </Badge>
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>選擇常用記錄</DialogTitle>
                            <DialogDescription>點擊項目將自動填入表單。</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
                            {currentTemplates.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    尚無常用記錄，請先在表單中點擊「存為常用」。
                                </div>
                            ) : (
                                currentTemplates.map((t: any) => (
                                    <div
                                        key={t.id}
                                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                                        onClick={() => handleLoadTemplate(t)}
                                    >
                                        <div className="flex-1">
                                            <div className="font-medium">{t.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {t.type === 'PURCHASE' ? (
                                                    <>
                                                        {items.find(i => i.id === t.itemId)?.name || '未知品項'}
                                                        {t.inputQuantity ? ` · ${t.inputQuantity}${units.find(u => u.code === t.inputUnit)?.name || t.inputUnit}` : ''}
                                                        {t.totalPrice ? ` · $${t.totalPrice}` : ''}
                                                    </>
                                                ) : (
                                                    <>
                                                        {expenseTypes.find(e => e.value === t.expenseType)?.label || t.expenseType}
                                                        {t.totalPrice ? ` · $${t.totalPrice}` : ''}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                            onClick={(e) => handleDeleteTemplate(e, t.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>
                    </DialogContent>
                </Dialog>

                <Dialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen}>
                    <DialogTrigger asChild>
                        <Button variant="outline" className="gap-2 aspect-square p-0 w-10 md:w-auto md:aspect-auto md:px-4">
                            <Save className="h-4 w-4" />
                            <span className="hidden md:inline">存為常用</span>
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>儲存為常用記錄</DialogTitle>
                            <DialogDescription>將目前填寫的內容儲存為模板，方便下次快速使用。</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>模板名稱</Label>
                                <Input
                                    placeholder="例如：每日豬肉進貨"
                                    value={newTemplateName}
                                    onChange={(e) => setNewTemplateName(e.target.value)}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleSaveTemplate} disabled={loading}>
                                {loading ? "儲存中..." : "儲存"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="flex p-1 bg-muted rounded-lg">
                <button
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${type === 'PURCHASE' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                        }`}
                    onClick={() => setType('PURCHASE')}
                    type="button"
                >
                    進貨
                </button>
                <button
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${type === 'EXPENSE' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
                        }`}
                    onClick={() => setType('EXPENSE')}
                    type="button"
                >
                    其他支出
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                    <Label>日期</Label>
                    <div className="flex gap-2">
                        <Input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="flex-1"
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setDate(formatDateInput(new Date()))}
                            title="回到今天"
                        >
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {type === 'PURCHASE' ? (
                    <>
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>類別</Label>
                                <Select
                                    value={selectedCategory}
                                    onValueChange={(value) => {
                                        setSelectedCategory(value);
                                        setSelectedItem("");
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="選擇分類" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {categories.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {categories.length === 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        尚無類別，請先到「設定 → 品項管理」新增。
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>品項</Label>
                                    <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="gap-1" disabled={!selectedCategory}>
                                                <PackagePlus className="h-4 w-4" /> 新增品項
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader>
                                                <DialogTitle>新增品項</DialogTitle>
                                                <DialogDescription>新增後會自動加入清單，方便下次使用。</DialogDescription>
                                            </DialogHeader>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>品項名稱</Label>
                                                    <Input
                                                        placeholder="例如：五花肉"
                                                        value={newItemName}
                                                        onChange={(e) => setNewItemName(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>預設單位</Label>
                                                    <Select value={newItemUnit} onValueChange={setNewItemUnit}>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {units.map((u) => (
                                                                <SelectItem key={u.code} value={u.code}>{u.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <DialogFooter>
                                                <Button type="button" onClick={handleCreateItem}>
                                                    儲存
                                                </Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                                <Select value={selectedItem} onValueChange={setSelectedItem} disabled={!selectedCategory}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={selectedCategory ? "選擇品項" : "請先選擇類別"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableItems.map((i) => (
                                            <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedCategory && availableItems.length === 0 && (
                                    <p className="text-xs text-muted-foreground">此類別尚無品項，請先新增。</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>廠商</Label>
                                    <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="sm" className="gap-1">
                                                <Store className="h-4 w-4" /> 新增廠商
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent>
                                            <DialogHeader>
                                                <DialogTitle>新增廠商</DialogTitle>
                                                <DialogDescription>廠商資訊可留空，先建立名稱即可。</DialogDescription>
                                            </DialogHeader>
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <Label>廠商名稱</Label>
                                                    <Input
                                                        placeholder="例如：屏東肉商"
                                                        value={newVendorName}
                                                        onChange={(e) => setNewVendorName(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>聯絡人</Label>
                                                    <Input
                                                        placeholder="選填"
                                                        value={newVendorContact}
                                                        onChange={(e) => setNewVendorContact(e.target.value)}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>電話</Label>
                                                    <Input
                                                        placeholder="選填"
                                                        value={newVendorPhone}
                                                        onChange={(e) => setNewVendorPhone(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            <DialogFooter>
                                                <Button type="button" onClick={handleCreateVendor}>
                                                    儲存
                                                </Button>
                                            </DialogFooter>
                                        </DialogContent>
                                    </Dialog>
                                </div>
                                <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="選擇廠商 (可選)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableVendors.map((v) => (
                                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {availableVendors.length === 0 && (
                                    <p className="text-xs text-muted-foreground">尚無廠商資料，可直接新增。</p>
                                )}
                            </div>
                        </div>

                        <Card className="border-primary/20 bg-primary/5">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">數量與價格</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>數量</Label>
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.01"
                                            min="0"
                                            placeholder="0.00"
                                            value={weight}
                                            onChange={(e) => setWeight(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">秤重請填公斤或臺斤；非秤重請填件數。</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>單位</Label>
                                        <Select value={unit} onValueChange={setUnit}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {units.map((u) => (
                                                    <SelectItem key={u.code} value={u.code}>{u.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {summary && (
                                    <div className="text-sm text-primary font-medium text-right">
                                        {summary}
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label>總金額 (TWD)</Label>
                                    <Input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        placeholder="0"
                                        className="text-lg font-bold"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                    />
                                    <p className="text-xs text-muted-foreground">請輸入實際付款金額。</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>備註</Label>
                                    <Input
                                        placeholder="例如：今天特價、品質較好"
                                        value={purchaseNote}
                                        onChange={(e) => setPurchaseNote(e.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>支出項目</Label>
                                <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="gap-1">
                                            <ClipboardList className="h-4 w-4" /> 新增項目
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>新增支出項目</DialogTitle>
                                            <DialogDescription>例如：租金、瓦斯、電費等。</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                            <div className="space-y-2">
                                                <Label>名稱</Label>
                                                <Input
                                                    placeholder="例如：瓦斯"
                                                    value={newExpenseLabel}
                                                    onChange={(e) => setNewExpenseLabel(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button type="button" onClick={handleCreateExpenseType}>
                                                儲存
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                            <Select value={selectedExpenseType} onValueChange={setSelectedExpenseType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇項目" />
                                </SelectTrigger>
                                <SelectContent>
                                    {expenseOptions.map((e) => (
                                        <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {expenseOptions.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    尚無支出項目，可直接新增。
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label>金額 (TWD)</Label>
                            <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                placeholder="0"
                                className="text-lg font-bold"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>備註</Label>
                            <Input
                                placeholder="選填，例如：瓦斯桶更換"
                                value={expenseNote}
                                onChange={(e) => setExpenseNote(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                <Button type="submit" size="lg" className="w-full text-base" disabled={loading}>
                    {loading ? "儲存中..." : (type === 'PURCHASE' ? "確認進貨" : "確認支出")}
                </Button>
            </form>
        </div>
    );
}
