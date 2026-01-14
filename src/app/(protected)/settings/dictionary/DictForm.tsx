"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { createDictionaryItem } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function DictForm() {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createDictionaryItem(formData);
        if (res.success) {
            toast({ title: "成功", description: "字典項已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增項
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增字典項</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>類別 (Category)</Label>
                        <Input name="category" required placeholder="如: unit, expense_type" />
                    </div>
                    <div className="space-y-2">
                        <Label>名稱 (Label)</Label>
                        <Input name="label" required placeholder="如: 公斤" />
                    </div>
                    <div className="space-y-2">
                        <Label>值 (Value)</Label>
                        <Input name="value" required placeholder="如: kg" />
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
