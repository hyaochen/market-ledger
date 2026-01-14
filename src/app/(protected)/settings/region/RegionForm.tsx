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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { createRegion } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function RegionForm({ regions }: { regions: any[] }) {
    const [open, setOpen] = useState(false);
    const [regionType, setRegionType] = useState("COUNTRY");
    const [parentId, setParentId] = useState("root");
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createRegion(formData);
        if (res.success) {
            toast({ title: "成功", description: "區域已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增區域</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="type" value={regionType} />
                    <input type="hidden" name="parentId" value={parentId} />
                    <div className="space-y-2">
                        <Label>名稱</Label>
                        <Input name="name" required placeholder="如: 屏東縣" />
                    </div>
                    <div className="space-y-2">
                        <Label>代碼 (Code)</Label>
                        <Input name="code" required placeholder="如: PT" />
                    </div>
                    <div className="space-y-2">
                        <Label>類型</Label>
                        <Select value={regionType} onValueChange={setRegionType}>
                            <SelectTrigger>
                                <SelectValue placeholder="選擇類型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="COUNTRY">國家</SelectItem>
                                <SelectItem value="PROVINCE">省/直轄市</SelectItem>
                                <SelectItem value="CITY">地市</SelectItem>
                                <SelectItem value="DISTRICT">區縣</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>上級區域</Label>
                        <Select value={parentId} onValueChange={setParentId}>
                            <SelectTrigger>
                                <SelectValue placeholder="無 (頂層)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="root">無 (頂層)</SelectItem>
                                {regions.map(r => (
                                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button type="submit">儲存</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
