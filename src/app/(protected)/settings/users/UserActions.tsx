"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, UserCheck, UserX } from "lucide-react";
import { toggleUserStatus, deleteUser, updateUserRole } from "@/app/actions/admin";
import { useToast } from "@/components/ui/use-toast";

interface Role {
    id: string;
    name: string;
    code: string;
}

interface UserActionsProps {
    userId: string;
    username: string;
    realName: string | null;
    status: boolean;
    currentRoleId: string | null;
    roles: Role[];
    isSelf: boolean;
}

export default function UserActions({ userId, username, realName, status, currentRoleId, roles, isSelf }: UserActionsProps) {
    const [loading, setLoading] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [selectedRoleId, setSelectedRoleId] = useState(currentRoleId ?? roles[0]?.id ?? "");
    const { toast } = useToast();

    const handleToggle = async () => {
        setLoading(true);
        const res = await toggleUserStatus(userId, !status);
        setLoading(false);
        if (res.success) {
            toast({ title: "成功", description: status ? "使用者已停用" : "使用者已啟用" });
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    const handleDelete = async () => {
        setLoading(true);
        const res = await deleteUser(userId);
        setLoading(false);
        setDeleteOpen(false);
        if (res.success) {
            toast({ title: "成功", description: "使用者已刪除" });
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    const handleEditSave = async () => {
        if (!selectedRoleId) return;
        setLoading(true);
        const res = await updateUserRole(userId, selectedRoleId);
        setLoading(false);
        if (res.success) {
            setEditOpen(false);
            toast({ title: "成功", description: "角色已更新" });
        } else {
            toast({ title: "失敗", description: res.error, variant: "destructive" });
        }
    };

    if (isSelf) return null;

    return (
        <>
            {/* 編輯角色 */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={loading}
                onClick={() => setEditOpen(true)}
                title="編輯角色"
            >
                <Pencil className="h-4 w-4 text-muted-foreground" />
            </Button>

            {/* 停用/啟用 */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={loading}
                onClick={handleToggle}
                title={status ? "停用帳號" : "啟用帳號"}
            >
                {status ? (
                    <UserX className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <UserCheck className="h-4 w-4 text-green-600" />
                )}
            </Button>

            {/* 刪除 */}
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={loading}
                onClick={() => setDeleteOpen(true)}
                title="刪除帳號"
            >
                <Trash2 className="h-4 w-4 text-destructive" />
            </Button>

            {/* 編輯角色對話框 */}
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>編輯使用者</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-muted-foreground">帳號</p>
                            <p className="text-sm font-semibold">@{username}{realName ? ` (${realName})` : ""}</p>
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-medium">角色</p>
                            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="選擇角色" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(r => (
                                        <SelectItem key={r.id} value={r.id}>
                                            {r.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
                        <Button disabled={loading || !selectedRoleId} onClick={handleEditSave}>儲存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 刪除確認對話框 */}
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>確認刪除使用者？</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">此操作無法復原，使用者帳號將永久刪除。</p>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button>
                        <Button variant="destructive" disabled={loading} onClick={handleDelete}>確認刪除</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
