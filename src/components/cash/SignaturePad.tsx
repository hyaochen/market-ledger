"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";

type Props = {
    label: string;
    value: string | null;
    onChange: (dataUrl: string | null) => void;
};

export default function SignaturePad({ label, value, onChange }: Props) {
    const [open, setOpen] = useState(false);

    function handleClear() {
        onChange(null);
    }

    return (
        <div className="flex flex-col">
            <div
                className="h-24 sm:h-28 border-2 border-dashed border-zinc-400 rounded-md bg-white/70 flex items-center justify-center cursor-pointer select-none"
                onDoubleClick={() => setOpen(true)}
                onClick={() => {
                    if (!value) setOpen(true);
                }}
                role="button"
                tabIndex={0}
            >
                {value ? (
                    <img src={value} alt={`${label} 簽名`} className="max-h-full max-w-full object-contain" />
                ) : (
                    <span className="text-sm text-zinc-500">✍ 點兩下開始簽名</span>
                )}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-zinc-600">{label}</span>
                {value && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="text-red-600 underline"
                    >
                        清除
                    </button>
                )}
            </div>

            {open && (
                <SignatureModal
                    label={label}
                    initialValue={value}
                    onClose={() => setOpen(false)}
                    onDone={(dataUrl) => {
                        onChange(dataUrl);
                        setOpen(false);
                    }}
                />
            )}
        </div>
    );
}

function SignatureModal({
    label,
    initialValue,
    onClose,
    onDone,
}: {
    label: string;
    initialValue: string | null;
    onClose: () => void;
    onDone: (dataUrl: string) => void;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const padRef = useRef<SignaturePadLib | null>(null);

    // body scroll lock + overscroll guard
    // T-ML-006: 不要在 body 設 touchAction:'none' — iOS Safari PWA 會把 fixed-position modal 內
    // 的 touch 視為 page-level prevented，導致 canvas 收不到 touch event。只用 overflow:hidden +
    // overscrollBehavior:contain 鎖滾動；touchAction:'none' 由 canvas 自己負責。
    useEffect(() => {
        const prevOverflow = document.body.style.overflow;
        const prevOverscroll = document.body.style.overscrollBehavior;
        document.body.style.overflow = "hidden";
        document.body.style.overscrollBehavior = "contain";
        return () => {
            document.body.style.overflow = prevOverflow;
            document.body.style.overscrollBehavior = prevOverscroll;
        };
    }, []);

    // T-ML-005: 改用 signature_pad library
    // T-ML-002/003/004 自寫 canvas + React/native pointer events 三輪改不掉 iOS Safari PWA 觸控失效；
    // signature_pad（npm 週下載 1M+）已處理所有 cross-platform quirks。
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const pad = new SignaturePadLib(canvas, {
            backgroundColor: "rgb(255, 255, 255)",
            penColor: "rgb(31, 41, 55)", // zinc-800
            minWidth: 1,
            maxWidth: 3,
        });
        padRef.current = pad;

        // T-ML-007: 拖曳期間禁止 resize，避免 canvas.width 改變抹掉正在繪製的 stroke。
        // owner 6/14 22:47 desktop 症狀「點第一下有點 拖曳沒線」root cause 即此 —
        // ResizeObserver 在拖曳中被觸發 → toData snapshot（不含進行中的 stroke）→ canvas.width=
        // 清空繪圖 → fromData restore → 新 stroke state 也被 reset。
        let isDrawing = false;
        pad.addEventListener("beginStroke", () => {
            isDrawing = true;
        });
        pad.addEventListener("endStroke", () => {
            isDrawing = false;
        });

        const resizeCanvas = () => {
            if (isDrawing) return; // 拖曳中不 resize，避免抹掉 stroke
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            // toData / fromData 保留筆觸，避免 resize 抹掉 user input
            const data = pad.toData();
            canvas.width = rect.width * ratio;
            canvas.height = rect.height * ratio;
            // 設 canvas.width 會 reset 2D transform，scale 是 fresh state 不會累積（T-ML-003 已驗）
            const ctx = canvas.getContext("2d");
            ctx?.scale(ratio, ratio);
            if (data && data.length > 0) {
                pad.fromData(data);
            } else {
                pad.clear();
            }
        };

        // 等 layout 穩定再 init — iOS Safari modal mount 後 viewport 偶爾未 ready 就量到 0×0
        const rafId = window.requestAnimationFrame(() => {
            resizeCanvas();
            if (initialValue) {
                pad.fromDataURL(initialValue).catch(() => {
                    // 損壞的 dataUrl 不阻塞，留白讓 user 重簽
                });
            }
        });
        // T-ML-007: 拿掉 ResizeObserver — modal 是 fixed inset-0，CSS rect 不會隨內容變動，
        // ResizeObserver 多此一舉而且**會在拖曳期間誤觸發**。改靠 visualViewport.resize +
        // orientationchange 應付 iOS Safari address bar 動態高度 + 螢幕旋轉就夠。
        const vv = window.visualViewport;
        vv?.addEventListener("resize", resizeCanvas);
        vv?.addEventListener("scroll", resizeCanvas);
        window.addEventListener("orientationchange", resizeCanvas);

        return () => {
            window.cancelAnimationFrame(rafId);
            vv?.removeEventListener("resize", resizeCanvas);
            vv?.removeEventListener("scroll", resizeCanvas);
            window.removeEventListener("orientationchange", resizeCanvas);
            pad.off();
            padRef.current = null;
        };
    }, [initialValue]);

    function handleClear() {
        padRef.current?.clear();
    }

    function handleDone() {
        const pad = padRef.current;
        if (!pad) return;
        // 即便空白也回傳 dataUrl，保持與 T-ML-003/004 相同對外行為
        const dataUrl = pad.toDataURL("image/png");
        onDone(dataUrl);
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/95 flex flex-col"
            role="dialog"
            aria-modal
        >
            {/* 標題列：右上角浮動關閉按鈕（醒目） */}
            <div className="flex items-center justify-between px-4 py-3 text-white">
                <div className="text-sm sm:text-base">
                    <span className="font-semibold">{label}</span>
                    <span className="ml-2 text-zinc-300 text-xs">請於下方簽名（手指或筆觸控）</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="取消並關閉簽名"
                    className="w-10 h-10 rounded-full bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 text-white text-xl flex items-center justify-center"
                >
                    ✕
                </button>
            </div>

            {/* T-ML-009: 直握手機 UX 提示 — T-ML-008 CSS rotate 走不通改純 prompt
                只 portrait + 手機尺寸顯示，landscape 跟桌面/iPad 自動隱藏 */}
            <div className="orientation-portrait-only flex-col items-center justify-center px-6 py-3 bg-amber-500/95 text-white border-b border-amber-700">
                <span className="text-2xl mb-1">📱 ↻</span>
                <span className="font-semibold text-base">請把手機橫過來簽名</span>
                <span className="text-xs text-amber-100 mt-1">橫向才有完整簽名空間</span>
            </div>

            {/* canvas 區塊 */}
            <div className="flex-1 flex items-stretch justify-stretch px-3 pb-2 min-h-0">
                <canvas
                    ref={canvasRef}
                    className="flex-1 bg-white rounded-md touch-none"
                    style={{ touchAction: "none", display: "block" }}
                />
            </div>

            {/* 底部三顆大按鈕 — sticky + safe-area */}
            <div
                className="grid grid-cols-3 gap-3 px-4 py-3 bg-black/60 border-t border-zinc-700"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    className="py-3 bg-zinc-600 hover:bg-zinc-500 active:bg-zinc-700 text-white text-base font-semibold rounded-lg"
                >
                    ✕ 取消
                </button>
                <button
                    type="button"
                    onClick={handleClear}
                    className="py-3 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-base font-semibold rounded-lg"
                >
                    🔄 重畫
                </button>
                <button
                    type="button"
                    onClick={handleDone}
                    className="py-3 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-base font-bold rounded-lg shadow-lg"
                >
                    ✓ 完成
                </button>
            </div>
        </div>
    );
}
