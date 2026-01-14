"use client";

import { useState } from "react";
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
import { Plus } from "lucide-react";
import { createUnit } from "@/app/actions/catalog";
import { useToast } from "@/components/ui/use-toast";

export default function UnitForm() {
    const [open, setOpen] = useState(false);
    const [isWeight, setIsWeight] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createUnit(formData);
        if (res.success) {
            toast({ title: "成功", description: "單位已建立" });
            setOpen(false);
            setIsWeight(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增單位
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增單位</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>顯示名稱</Label>
                        <Input name="label" required placeholder="例如：公斤、包、袋" />
                    </div>
                    <div className="space-y-2">
                        <Label>代碼</Label>
                        <Input name="value" required placeholder="例如：kg、pack" />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isWeight"
                            name="isWeight"
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={isWeight}
                            onChange={(e) => setIsWeight(e.target.checked)}
                        />
                        <Label htmlFor="isWeight">此單位需要重量換算</Label>
                    </div>
                    {isWeight && (
                        <div className="space-y-2">
                            <Label>換算成公斤 (1 單位 = ? 公斤)</Label>
                            <Input name="toKg" type="number" inputMode="decimal" step="0.01" placeholder="例如：0.6" />
                        </div>
                    )}
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
