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
import { createPermission } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function MenuForm({ permissions }: { permissions: any[] }) {
    const [open, setOpen] = useState(false);
    const [permissionType, setPermissionType] = useState("MENU");
    const [parentId, setParentId] = useState("root");
    const { toast } = useToast();

    const handleSubmit = async (formData: FormData) => {
        const res = await createPermission(formData);
        if (res.success) {
            toast({ title: "成功", description: "功能表已建立" });
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
                    <DialogTitle>新增功能表/權限</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="type" value={permissionType} />
                    <input type="hidden" name="parentId" value={parentId} />
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>名稱</Label>
                            <Input name="name" required placeholder="如: 進貨管理" />
                        </div>
                        <div className="space-y-2">
                            <Label>權限標識</Label>
                            <Input name="code" required placeholder="如: entry:view" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>類型</Label>
                        <Select value={permissionType} onValueChange={setPermissionType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="MENU">菜單</SelectItem>
                                <SelectItem value="BUTTON">按鈕</SelectItem>
                                <SelectItem value="API">接口</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>路徑 (Path)</Label>
                        <Input name="path" placeholder="如: /inventory" />
                    </div>

                    <div className="space-y-2">
                        <Label>上級功能</Label>
                        <Select value={parentId} onValueChange={setParentId}>
                            <SelectTrigger>
                                <SelectValue placeholder="無 (頂層)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="root">無 (頂層)</SelectItem>
                                {permissions.map(p => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
