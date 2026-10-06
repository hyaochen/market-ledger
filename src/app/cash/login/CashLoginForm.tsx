"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LoaderCircle, TriangleAlert } from "lucide-react";
import { login } from "@/app/actions/auth";
import { btn, INPUT, notice } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

export default function CashLoginForm() {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    function handleSubmit(formData: FormData) {
        setError(null);
        startTransition(async () => {
            const res = await login(formData);
            if (!res.success) {
                // login action 回傳的訊息原文呈現（含「登入嘗試過多，請 N 分鐘後再試」）
                setError(res.message || "登入失敗");
                return;
            }
            router.push("/cash");
            router.refresh();
        });
    }

    return (
        <form action={handleSubmit} className="space-y-5">
            <div>
                <label htmlFor="username" className="mb-1.5 block text-base font-semibold text-stone-900">
                    帳號
                </label>
                <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    className={cn(INPUT, "h-14 text-lg")}
                />
            </div>

            <div>
                <label htmlFor="password" className="mb-1.5 block text-base font-semibold text-stone-900">
                    密碼
                </label>
                <div className="relative">
                    <input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        className={cn(INPUT, "h-14 pr-14 text-lg")}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                        aria-pressed={showPassword}
                        className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-stone-700 transition-colors duration-150 hover:bg-stone-100 motion-reduce:transition-none"
                    >
                        {showPassword ? (
                            <EyeOff className="h-6 w-6" aria-hidden="true" />
                        ) : (
                            <Eye className="h-6 w-6" aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>

            {/* 錯誤區塊常駐在 DOM 裡，內容出現時螢幕閱讀器才會念出來 */}
            <div role="alert">
                {error ? (
                    <p className={notice("bad", "text-base")}>
                        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                        <span>{error}</span>
                    </p>
                ) : null}
            </div>

            <button
                type="submit"
                disabled={isPending}
                aria-busy={isPending}
                className={btn("primary", "lg", "w-full")}
            >
                {isPending ? (
                    <>
                        <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        登入中…
                    </>
                ) : (
                    "登入"
                )}
            </button>
        </form>
    );
}
