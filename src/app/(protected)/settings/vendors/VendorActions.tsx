"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { deleteVendor } from "@/app/actions/catalog";

export default function VendorActions({ vendorId }: { vendorId: string }) {
    const { toast } = useToast();

    const handleDelete = async () => {
        if (!confirm("確定要刪除此廠商嗎？")) return;
        const result = await deleteVendor(vendorId);
        if (result.success) {
            toast({ title: "已刪除", description: "廠商已刪除" });
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
