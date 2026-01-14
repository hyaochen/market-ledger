"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { login } from "@/app/actions/auth";

export default function LoginPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [pending, startTransition] = useTransition();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();

        startTransition(async () => {
            const formData = new FormData();
            formData.append("username", username);
            formData.append("password", password);
            const result = await login(formData);
            if (result.success) {
                toast({ title: "登入成功", description: "歡迎使用系統" });
                router.push("/");
                router.refresh();
            } else {
                toast({ title: "登入失敗", description: result.message, variant: "destructive" });
            }
        });
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle>登入系統</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>帳號</Label>
                            <Input
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="請輸入帳號"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>密碼</Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="請輸入密碼"
                                required
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={pending}>
                            {pending ? "登入中..." : "登入"}
                        </Button>
                    </form>
                    <div className="mt-4 text-xs text-muted-foreground">
                        預設唯讀帳號：viewer / viewer123
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
