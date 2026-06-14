"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/app/actions/auth";

export default function CashLoginForm() {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function handleSubmit(formData: FormData) {
        setError(null);
        startTransition(async () => {
            const res = await login(formData);
            if (!res.success) {
                setError(res.message || "登入失敗");
                return;
            }
            router.push("/cash");
            router.refresh();
        });
    }

    return (
        <form action={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="username" className="block text-sm font-medium mb-1">
                    帳號
                </label>
                <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
            </div>
            <div>
                <label htmlFor="password" className="block text-sm font-medium mb-1">
                    密碼
                </label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-md bg-amber-600 text-white py-2.5 text-base font-medium hover:bg-amber-700 active:bg-amber-800 disabled:opacity-60"
            >
                {isPending ? "登入中…" : "登入"}
            </button>
        </form>
    );
}
