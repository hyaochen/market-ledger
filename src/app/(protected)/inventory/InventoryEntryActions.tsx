"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { deleteEntry, updateEntry } from "@/app/actions/entry";
import { createTemplate } from "@/app/actions/template";
import type { UnitDef } from "@/lib/units";
import { formatDateInput } from "@/lib/date";
import { Star } from "lucide-react";

type EntryRecord = {
    id: string;
    date: string;
    type: string;
    itemId: string | null;
    vendorId: string | null;
    inputQuantity: number | null;
    inputUnit: string | null;
    totalPrice: number;
    note: string | null;
    expenseType: string | null;
};

export default function InventoryEntryActions({
    entry,
    items,
    vendors,
    expenseTypes,
    units,
}: {
    entry: EntryRecord;
    items: any[];
    vendors: any[];
    expenseTypes: any[];
    units: UnitDef[];
}) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [templateOpen, setTemplateOpen] = useState(false);
    const [templateName, setTemplateName] = useState("");
    const [loading, setLoading] = useState(false);

    const [date, setDate] = useState(formatDateInput(new Date(entry.date)));
    const [itemId, setItemId] = useState(entry.itemId || items[0]?.id || "");
    const [vendorId, setVendorId] = useState(entry.vendorId || "");
    const [quantity, setQuantity] = useState(entry.inputQuantity?.toString() || "0");
    const [unit, setUnit] = useState(entry.inputUnit || units[0]?.code || "kg");
    const [price, setPrice] = useState(entry.totalPrice.toString());
    const [note, setNote] = useState(entry.note || "");
    const [expenseType, setExpenseType] = useState(entry.expenseType || expenseTypes[0]?.value || "");
    const [expenseQuantity, setExpenseQuantity] = useState(entry.inputQuantity?.toString() || "");
    const [expenseEditUnit, setExpenseEditUnit] = useState(entry.inputUnit || "none");

    const handleSave = async () => {
        setLoading(true);
        const formData = new FormData();
        formData.append("type", entry.type);
        formData.append("date", date);
        if (entry.type === "PURCHASE") {
            formData.append("itemId", itemId);
            formData.append("vendorId", vendorId || "none");
            formData.append("weight", quantity);
            formData.append("unit", unit);
            formData.append("price", price);
            formData.append("note", note);
        } else {
            formData.append("expenseType", expenseType);
            formData.append("amount", price);
            formData.append("note", note);
            if (expenseQuantity) formData.append("expenseQuantity", expenseQuantity);
            formData.append("expenseUnit", expenseEditUnit);
        }

        const result = await updateEntry(entry.id, formData);
        setLoading(false);

        if (result.success) {
            toast({ title: "已更新", description: "記錄已更新" });
            setOpen(false);
            router.refresh();
        } else {
            toast({ title: "更新失敗", description: result.message, variant: "destructive" });
        }
    };

    const handleDelete = async () => {
        if (!confirm("確定要刪除此筆進貨記錄嗎？")) return;
        setLoading(true);
        const result = await deleteEntry(entry.id);
        setLoading(false);

        if (result.success) {
            toast({ title: "已刪除", description: "記錄已刪除" });
            router.refresh();
        } else {
            toast({ title: "刪除失敗", description: result.message, variant: "destructive" });
        }
    };

    const handleSaveAsTemplate = async () => {
        if (!templateName.trim()) {
            toast({ title: "請輸入常用名稱", variant: "destructive" });
            return;
        }
        setLoading(true);
        const formData = new FormData();
        formData.append('name', templateName.trim());
        formData.append('type', entry.type);
        if (entry.type === 'PURCHASE') {
            if (entry.itemId) formData.append('itemId', entry.itemId);
            formData.append('vendorId', entry.vendorId || 'none');
            formData.append('weight', entry.inputQuantity?.toString() || '');
            formData.append('unit', entry.inputUnit || 'kg');
            formData.append('price', entry.totalPrice.toString());
            formData.append('note', entry.note || '');
        } else {
            formData.append('expenseType', entry.expenseType || '');
            formData.append('amount', entry.totalPrice.toString());
            formData.append('note', entry.note || '');
            if (entry.inputQuantity) formData.append('weight', entry.inputQuantity.toString());
            if (entry.inputUnit) formData.append('unit', entry.inputUnit);
        }
        const result = await createTemplate(formData);
        setLoading(false);
        if (result.success) {
            toast({ title: "已加入常用", description: "可在新增記錄時快速套用" });
            setTemplateOpen(false);
            setTemplateName("");
        } else {
            toast({ title: "儲存失敗", description: result.message, variant: "destructive" });
        }
    };

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {/* 加入常用 */}
            <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
                <DialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" title="加入常用">
                        <Star className="h-4 w-4" />
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>加入常用記錄</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-muted-foreground">將此筆記錄儲存為常用，方便下次在新增頁面快速套用。</p>
                        <div className="space-y-2">
                            <Label>常用名稱</Label>
                            <Input
                                placeholder="例如：每日豬肉進貨"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveAsTemplate()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTemplateOpen(false)}>取消</Button>
                        <Button onClick={handleSaveAsTemplate} disabled={loading}>
                            {loading ? "儲存中..." : "儲存"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button size="sm" variant="outline">編輯</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>編輯記錄</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>日期</Label>
                            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                        </div>
                        {entry.type === "PURCHASE" ? (
                            <>
                                <div className="space-y-2">
                                    <Label>品項</Label>
                                    <Select value={itemId} onValueChange={setItemId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="選擇品項" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {items.map((item) => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>廠商</Label>
                                    <Select
                                        value={vendorId || "none"}
                                        onValueChange={(value) => setVendorId(value === "none" ? "" : value)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="選擇廠商" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">未指定</SelectItem>
                                            {vendors.map((vendor) => (
                                                <SelectItem key={vendor.id} value={vendor.id}>
                                                    {vendor.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>數量</Label>
                                        <Input
                                            type="number"
                                            value={quantity}
                                            onChange={(e) => setQuantity(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>單位</Label>
                                        <Select value={unit} onValueChange={setUnit}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {units.map((unitOption) => (
                                                    <SelectItem key={unitOption.code} value={unitOption.code}>
                                                        {unitOption.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>總金額 (TWD)</Label>
                                    <Input
                                        type="number"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>支出項目</Label>
                                    <Select value={expenseType} onValueChange={setExpenseType}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="選擇支出" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {expenseTypes.map((item) => (
                                                <SelectItem key={item.value} value={item.value}>
                                                    {item.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>金額 (TWD)</Label>
                                    <Input
                                        type="number"
                                        value={price}
                                        onChange={(e) => setPrice(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="flex gap-1">數量 <span className="text-xs text-muted-foreground">(選填)</span></Label>
                                        <Input
                                            type="number"
                                            placeholder="選填"
                                            value={expenseQuantity}
                                            onChange={(e) => setExpenseQuantity(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="flex gap-1">單位 <span className="text-xs text-muted-foreground">(選填)</span></Label>
                                        <Select value={expenseEditUnit} onValueChange={setExpenseEditUnit}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="不指定" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">不指定</SelectItem>
                                                {units.map((u) => (
                                                    <SelectItem key={u.code} value={u.code}>{u.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </>
                        )}
                        <div className="space-y-2">
                            <Label>備註</Label>
                            <Input value={note} onChange={(e) => setNote(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSave} disabled={loading}>
                            {loading ? "儲存中..." : "儲存"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete} disabled={loading}>
                {loading ? "處理中..." : "刪除"}
            </Button>
        </div>
    );
}
