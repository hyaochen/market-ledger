"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { browserHasCashDraft } from "@/lib/cash-draft";
import CashConfirmDialog from "./CashConfirmDialog";
import { btn, notice } from "./ui";

type Props = {
    /** header = 標頭小按鈕；block = 帳號頁的大按鈕 */
    variant?: "header" | "block";
};

/**
 * 登出（T-ML-034 A2）。標頭與帳號頁共用。
 *
 * 流程：點擊 -> 確認對話框 -> logout()（只清 session cookie，server action 本身沒改）
 *       -> router.replace("/cash/login") + router.refresh()。
 *
 * - 用 replace 而不是 push：瀏覽器「上一頁」不會回到已登入的畫面。
 * - logout() 的 cookie 變更會讓 Next 的 Router Cache 失效，再加上 refresh，
 *   所以回上一頁時各頁會重新向伺服器要資料，未登入就被導回登入頁。
 * - 若這台裝置的 sessionStorage 還有沒提交的清點草稿，對話框會提醒（草稿不會被清掉）。
 * - logout() 失敗（斷線等）：錯誤顯示在對話框內，不導頁，使用者可以再按一次。
 */
export default function CashLogoutButton({ variant = "header" }: Props) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [hasDraft, setHasDraft] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function handleOpenChange(next: boolean) {
        if (next) {
            setHasDraft(browserHasCashDraft());
            setError(null);
        }
        setOpen(next);
    }

    function handleConfirm() {
        setError(null);
        startTransition(async () => {
            try {
                await logout();
            } catch {
                setError("登出失敗，請確認網路連線後再按一次「登出」。");
                return;
            }
            router.replace("/cash/login");
            router.refresh();
        });
    }

    return (
        <>
            <button
                type="button"
                onClick={() => handleOpenChange(true)}
                aria-haspopup="dialog"
                className={
                    variant === "block"
                        ? btn("danger-outline", "lg", "w-full")
                        : btn("secondary", "sm", "px-3.5")
                }
            >
                <LogOut className={variant === "block" ? "h-6 w-6" : "h-5 w-5"} aria-hidden="true" />
                登出
            </button>

            <CashConfirmDialog
                open={open}
                onOpenChange={handleOpenChange}
                title="確定要登出嗎？"
                description="登出後，要重新輸入帳號和密碼才能使用。"
                confirmLabel="登出"
                pendingLabel="登出中…"
                pending={pending}
                error={error}
                onConfirm={handleConfirm}
            >
                {hasDraft ? (
                    <div className={notice("warn", "text-[15px]")}>
                        <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                        <p>這台裝置上還有尚未提交的清點草稿，用同一個帳號再次登入後可以還原。</p>
                    </div>
                ) : null}
            </CashConfirmDialog>
        </>
    );
}
