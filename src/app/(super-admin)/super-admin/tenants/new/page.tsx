"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTenant } from "@/app/actions/super-admin";

export default function NewTenantPage() {
    const router = useRouter();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (formData: FormData) => {
        setError("");
        setLoading(true);
        const result = await createTenant(formData);
        setLoading(false);

        if (result.success) {
            router.push("/super-admin/tenants");
        } else {
            setError(result.error || "建立失敗");
        }
    };

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-bold tracking-tight">新增企業</h1>
                <p className="text-muted-foreground text-sm">建立新的企業帳戶及其初始管理員。</p>
            </header>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">企業資訊</CardTitle>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-6">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>企業名稱 *</Label>
                                <Input name="name" required placeholder="如：美味鮮食有限公司" />
                            </div>
                            <div className="space-y-2">
                                <Label>企業代碼 *</Label>
                                <Input name="code" required placeholder="如：MVFOOD" />
                                <p className="text-xs text-muted-foreground">唯一識別碼，建立後無法修改</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>備註</Label>
                            <Input name="note" placeholder="選填" />
                        </div>

                        <div className="border-t pt-4">
                            <h3 className="font-medium mb-4">初始管理員帳號</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>管理員帳號 *</Label>
                                    <Input name="adminUsername" required placeholder="如：admin" />
                                </div>
                                <div className="space-y-2">
                                    <Label>管理員密碼 *</Label>
                                    <Input name="adminPassword" type="password" required placeholder="至少 4 個字元" />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                                {error}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <Button type="submit" disabled={loading}>
                                {loading ? "建立中..." : "建立企業"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => router.back()}>
                                取消
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
