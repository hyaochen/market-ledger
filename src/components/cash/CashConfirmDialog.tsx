"use client";

import { useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { btn } from "./ui";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: React.ReactNode;
    /** 放在說明下方的額外內容（例如草稿提醒） */
    children?: React.ReactNode;
    cancelLabel?: string;
    confirmLabel: string;
    /** 確認鈕在處理中顯示的文字，預設「處理中…」 */
    pendingLabel?: string;
    /** primary = 一般動作（登出）；danger = 會刪東西的動作 */
    tone?: "primary" | "danger";
    pending?: boolean;
    error?: string | null;
    onConfirm: () => void;
};

/**
 * cash 站統一的確認對話框（T-ML-034）：登出、丟棄草稿、刪除動作清單項目共用。
 *
 * 用 Radix Dialog 是為了拿到現成的無障礙行為：role="dialog" + aria-modal、
 * 焦點陷阱（Tab 不會跑到背景）、Esc 關閉、關閉後焦點回到原本的按鈕、背景 aria-hidden。
 *
 * 設計取捨：
 * - 「取消」放在 DOM 前面，所以開啟時初始焦點落在取消（不容易誤觸確認）。
 * - 兩顆按鈕一樣大（各佔一半、高 56px），手油油也按得準。
 * - 處理中（pending）時不能用 Esc 或點背景關掉，避免登出做到一半畫面消失。
 */
export default function CashConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    children,
    cancelLabel = "取消",
    confirmLabel,
    pendingLabel = "處理中…",
    tone = "primary",
    pending = false,
    error = null,
    onConfirm,
}: Props) {
    // 開啟前焦點在哪個按鈕，關閉後就還給它。
    // Radix 的 modal 只會把焦點還給 <Dialog.Trigger>；我們是用 open state 控制、沒有 Trigger，
    // 不自己處理的話，鍵盤使用者關掉對話框後焦點會掉到頁面最上面。
    const returnFocusRef = useRef<HTMLElement | null>(null);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="cash-dialog-overlay fixed inset-0 z-[60] bg-stone-900/55" />
                <Dialog.Content
                    aria-modal="true"
                    // 沒有說明文字時要明確關掉 aria-describedby，否則 Radix 會在 console 警告；
                    // 有說明文字時不能傳（傳了會蓋掉 Radix 自動綁好的 id）。
                    {...(description ? {} : { "aria-describedby": undefined })}
                    onOpenAutoFocus={() => {
                        const el = document.activeElement;
                        returnFocusRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
                    }}
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        const el = returnFocusRef.current;
                        returnFocusRef.current = null;
                        if (el && el.isConnected) el.focus();
                    }}
                    onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
                    onPointerDownOutside={(e) => { if (pending) e.preventDefault(); }}
                    className="cash-app cash-dialog-content fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-xl sm:p-6"
                >
                    <Dialog.Title className="text-xl font-bold text-stone-900">{title}</Dialog.Title>
                    {description ? (
                        <Dialog.Description className="mt-2 text-base leading-relaxed text-stone-700 text-pretty">
                            {description}
                        </Dialog.Description>
                    ) : null}
                    {children ? <div className="mt-3">{children}</div> : null}

                    {error ? (
                        <div
                            role="alert"
                            className="mt-4 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-base text-red-900"
                        >
                            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                            <span>{error}</span>
                        </div>
                    ) : null}

                    <div className="mt-6 grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            disabled={pending}
                            className={btn("secondary", "lg", "w-full")}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={pending}
                            aria-busy={pending}
                            className={btn(tone === "danger" ? "danger" : "primary", "lg", "w-full")}
                        >
                            {pending ? (
                                <>
                                    <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    {pendingLabel}
                                </>
                            ) : (
                                confirmLabel
                            )}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
