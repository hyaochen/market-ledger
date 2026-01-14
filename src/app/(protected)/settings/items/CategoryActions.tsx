"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { deleteCategory } from "@/app/actions/catalog";

export default function CategoryActions({ categoryId }: { categoryId: string }) {
    const { toast } = useToast();

    const handleDelete = async () => {
        if (!confirm("確定要刪除此類別嗎？")) return;
        const result = await deleteCategory(categoryId);
        if (result.success) {
            toast({ title: "已刪除", description: "類別已刪除" });
        } else {
            toast({ title: "刪除失敗", description: result.error, variant: "destructive" });
        }
    };

    return (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete}>
            刪除
        </Button>
    );
}
