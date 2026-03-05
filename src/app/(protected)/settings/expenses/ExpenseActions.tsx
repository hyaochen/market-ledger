"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { toggleDictionaryStatus, deleteDictionary } from "@/app/actions/catalog";

type Props = {
    id: string;
    isActive: boolean;
};

export default function ExpenseActions({ id, isActive }: Props) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleToggle = async () => {
        setLoading(true);
        const result = await toggleDictionaryStatus(id, !isActive);
        setLoading(false);
        if (result.success) {
            router.refresh();
        } else {
            toast({ title: "操作失敗", description: result.error, variant: "destructive" });
        }
    };

    const handleDelete = async () => {
        if (!confirm("確定要刪除此支出項目嗎？刪除後無法恢復，但已記錄的支出資料不受影響。")) return;
        setLoading(true);
        const result = await deleteDictionary(id);
        setLoading(false);
        if (result.success) {
            toast({ title: "已刪除" });
            router.refresh();
        } else {
            toast({ title: "刪除失敗", description: result.error, variant: "destructive" });
        }
    };

    return (
        <div className="flex gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={handleToggle} disabled={loading}>
                {isActive ? "停用" : "啟用"}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete} disabled={loading}>
                刪除
            </Button>
        </div>
    );
}
