"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { deleteItem, updateItem } from "@/app/actions/catalog";
import type { UnitDef } from "@/lib/units";

export default function ItemActions({
    item,
    categories,
    units,
}: {
    item: any;
    categories: any[];
    units: UnitDef[];
}) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(item.name || "");
    const [categoryId, setCategoryId] = useState(item.categoryId || "");
    const [defaultUnit, setDefaultUnit] = useState(item.defaultUnit || units[0]?.code || "kg");
    const [sortOrder, setSortOrder] = useState(item.sortOrder?.toString() || "0");

    const handleSave = async () => {
        const formData = new FormData();
        formData.append("name", name);
        formData.append("categoryId", categoryId);
        formData.append("defaultUnit", defaultUnit);
        formData.append("sortOrder", sortOrder);
        const result = await updateItem(item.id, formData);
        if (result.success) {
            toast({ title: "已更新", description: "品項資料已更新" });
            setOpen(false);
        } else {
            toast({ title: "更新失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleDelete = async () => {
        if (!confirm("確定要刪除此品項嗎？")) return;
        const result = await deleteItem(item.id);
        if (result.success) {
            toast({ title: "已刪除", description: "品項已刪除" });
        } else {
            toast({ title: "刪除失敗", description: result.error, variant: "destructive" });
        }
    };

    return (
        <div className="flex items-center gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button size="sm" variant="outline">編輯</Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>編輯品項</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>品項名稱</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>類別</Label>
                            <Select value={categoryId} onValueChange={setCategoryId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇類別" />
                                </SelectTrigger>
                                <SelectContent>
                                    {categories.map((category) => (
                                        <SelectItem key={category.id} value={category.id}>
                                            {category.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>預設單位</Label>
                            <Select value={defaultUnit} onValueChange={setDefaultUnit}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {units.map((unit) => (
                                        <SelectItem key={unit.code} value={unit.code}>
                                            {unit.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>排序</Label>
                            <Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={handleSave}>儲存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete}>
                刪除
            </Button>
        </div>
    );
}
