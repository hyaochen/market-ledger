import prisma from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Store, Phone, User } from "lucide-react";
import VendorForm from "./VendorForm";
import { toggleVendorStatus } from "@/app/actions/catalog";
import VendorActions from "./VendorActions";
import { getTenantId } from "@/lib/auth";

export default async function VendorsPage() {
    const tenantId = await getTenantId();
    const vendors = await prisma.vendor.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
    });

    return (
        <div className="space-y-6 pb-20">
            <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">廠商管理</h1>
                    <p className="text-muted-foreground text-sm">管理供應商與聯絡資訊。</p>
                </div>
                <VendorForm />
            </header>

            <div className="space-y-4">
                {vendors.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            尚無廠商資料，請先新增。
                        </CardContent>
                    </Card>
                ) : (
                    vendors.map((vendor) => (
                        <Card key={vendor.id}>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Store className="h-5 w-5 text-primary" />
                                    <CardTitle className="text-base">{vendor.name}</CardTitle>
                                </div>
                                <span
                                    className={`text-xs px-2 py-1 rounded-full ${vendor.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                                >
                                    {vendor.isActive ? "啟用" : "停用"}
                                </span>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm text-muted-foreground">
                                <div className="flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    {vendor.contact || "未填聯絡人"}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Phone className="h-4 w-4" />
                                    {vendor.phone || "未填電話"}
                                </div>
                                {vendor.note && (
                                    <div className="text-xs">{vendor.note}</div>
                                )}
                                <form
                                    action={async () => {
                                        "use server";
                                        await toggleVendorStatus(vendor.id, !vendor.isActive);
                                    }}
                                >
                                    <Button size="sm" variant="outline" className="mt-2">
                                        {vendor.isActive ? "停用" : "啟用"}
                                    </Button>
                                </form>
                                <VendorActions vendorId={vendor.id} />
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
