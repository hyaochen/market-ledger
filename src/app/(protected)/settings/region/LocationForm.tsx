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
import { createLocation } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function LocationForm({ regionId, regionName }: { regionId: string; regionName: string }) {
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createLocation(formData);
        if (res.success) {
            toast({ title: "成功", description: "場所已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
                    <Plus className="h-3 w-3" /> 新增場所
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增場所到「{regionName}」</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="regionId" value={regionId} />
                    <div className="space-y-2">
                        <Label>場所名稱</Label>
                        <Input name="name" required placeholder="如: 屏東攤位" />
                    </div>
                    <DialogFooter>
                        <Button type="submit">儲存</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
