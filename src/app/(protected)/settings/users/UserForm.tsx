"use client";

import { useEffect, useState } from "react";
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
import { createUser } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

export default function UserForm({ departments, roles }: { departments: any[], roles: any[] }) {
    const [open, setOpen] = useState(false);
    const [departmentId, setDepartmentId] = useState("none");
    const [roleId, setRoleId] = useState(roles[0]?.id || "");
    const { toast } = useToast();

    useEffect(() => {
        if (!roleId && roles.length > 0) {
            setRoleId(roles[0].id);
        }
    }, [roleId, roles]);

    const handleSubmit = async (formData: FormData) => {
        const res = await createUser(formData);
        if (res.success) {
            toast({ title: "成功", description: "使用者已建立" });
            setOpen(false);
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> 新增使用者
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>新增使用者</DialogTitle>
                </DialogHeader>
                <form action={handleSubmit} className="space-y-4">
                    <input type="hidden" name="departmentId" value={departmentId} />
                    <input type="hidden" name="roles" value={roleId} />
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>帳號 (Username)</Label>
                            <Input name="username" required />
                        </div>
                        <div className="space-y-2">
                            <Label>真實姓名</Label>
                            <Input name="realName" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>密碼</Label>
                        <Input name="password" type="password" required />
                    </div>

                    <div className="space-y-2">
                        <Label>部門</Label>
                        <Select value={departmentId} onValueChange={setDepartmentId}>
                            <SelectTrigger>
                                <SelectValue placeholder="選擇部門" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">無部門</SelectItem>
                                {departments.map(d => (
                                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>角色 (必選)</Label>
                        <Select value={roleId} onValueChange={setRoleId}>
                            <SelectTrigger>
                                <SelectValue placeholder="選擇角色" />
                            </SelectTrigger>
                            <SelectContent>
                                {roles.map(r => (
                                    <SelectItem key={r.id} value={r.id}>{r.name} ({r.code})</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {roles.length === 0 && (
                            <p className="text-xs text-muted-foreground">尚無角色，請先到角色管理補齊。</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button type="submit">儲存</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
