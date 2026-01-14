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
import { createExpenseType } from "@/app/actions/catalog";
import { useToast } from "@/components/ui/use-toast";

export default function ExpenseForm() {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createExpenseType(formData);
        if (res.success) {
            toast({ title: "成功", description: "支出項目已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增支出項目
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增支出項目</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>名稱</Label>
                        <Input name="label" required placeholder="例如：租金、瓦斯" />
                    </div>
                    <div className="space-y-2">
                        <Label>代碼 (可選)</Label>
                        <Input name="value" placeholder="例如：rent" />
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
