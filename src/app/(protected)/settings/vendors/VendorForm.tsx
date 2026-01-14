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
import { createVendor } from "@/app/actions/catalog";
import { useToast } from "@/components/ui/use-toast";

export default function VendorForm() {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createVendor(formData);
        if (res.success) {
            toast({ title: "成功", description: "廠商已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增廠商
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增廠商</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>廠商名稱</Label>
                        <Input name="name" required placeholder="例如：潮州菜商" />
                    </div>
                    <div className="space-y-2">
                        <Label>聯絡人</Label>
                        <Input name="contact" placeholder="選填" />
                    </div>
                    <div className="space-y-2">
                        <Label>電話</Label>
                        <Input name="phone" placeholder="選填" />
                    </div>
                    <div className="space-y-2">
                        <Label>備註</Label>
                        <Input name="note" placeholder="選填，例如：周二固定供貨" />
                    </div>
                    <DialogFooter>
                        <Button type="submit">儲存</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
