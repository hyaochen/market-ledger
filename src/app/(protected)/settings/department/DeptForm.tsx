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
import { createDepartment } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function DeptForm({ parentOptions }: { parentOptions: any[] }) {
    const [open, setOpen] = useState(false);
    const [parentId, setParentId] = useState("root");
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createDepartment(formData);
        if (res.success) {
            toast({ title: "成功", description: "部門已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增部門
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>新增部門</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="parentId" value={parentId} />
                    <div className="space-y-2">
                        <Label>部門名稱</Label>
                        <Input name="name" required placeholder="例如：採購部" />
                    </div>
                    <div className="space-y-2">
                        <Label>上級部門</Label>
                        <Select value={parentId} onValueChange={setParentId}>
                            <SelectTrigger>
                                <SelectValue placeholder="選擇上級..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="root">無 (頂層)</SelectItem>
                                {parentOptions.map(dept => (
                                    <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>排序 (Sort)</Label>
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
