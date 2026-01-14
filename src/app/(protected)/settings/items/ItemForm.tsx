"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { createItem } from "@/app/actions/catalog";
import { useToast } from "@/components/ui/use-toast";
import type { UnitDef } from "@/lib/units";

export default function ItemForm({
    categories,
    units,
}: {
    categories: any[];
    units: UnitDef[];
}) {
    const [open, setOpen] = useState(false);
    const [categoryId, setCategoryId] = useState("");
    const [defaultUnit, setDefaultUnit] = useState(units[0]?.code || "kg");
    const { toast } = useToast();

    useEffect(() => {
        if (!categoryId && categories.length > 0) {
            setCategoryId(categories[0].id);
        }
    }, [categoryId, categories]);

    const handleSubmit = async (formData: FormData) => {
        const res = await createItem(formData);
        if (res.success) {
            toast({ title: "成功", description: "品項已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增品項
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增品項</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="categoryId" value={categoryId} />
                    <input type="hidden" name="defaultUnit" value={defaultUnit} />
                    <div className="space-y-2">
                        <Label>品項名稱</Label>
                        <Input name="name" required placeholder="例如：高麗菜" />
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
                        <Input name="sortOrder" type="number" defaultValue="0" />
                    </div>
                    <DialogFooter>
                        <Button type="submit">儲存</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
