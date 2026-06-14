"use client";

import { useEffect, useRef, useState, useCallback } from "react";

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
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const hasDrawnRef = useRef(false);
    const lastSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

    const sizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const prevW = lastSizeRef.current.w;
        const prevH = lastSizeRef.current.h;
        const isResize = prevW !== 0 && (prevW !== rect.width || prevH !== rect.height);

        let snapshot: string | null = null;
        if (isResize && hasDrawnRef.current) {
            try {
                snapshot = canvas.toDataURL("image/png");
            } catch {
                snapshot = null;
            }
        }

        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#1f2937";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);

        if (snapshot) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, rect.width, rect.height);
            };
            img.src = snapshot;
        } else if (!hasDrawnRef.current && initialValue) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, rect.width, rect.height);
            };
            img.src = initialValue;
        }

        lastSizeRef.current = { w: rect.width, h: rect.height };
    }, [initialValue]);

    useEffect(() => {
        let rafId: number | null = null;
        const schedule = () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                sizeCanvas();
            });
        };

        // 初始 mount 後等 layout 穩定再 init
        schedule();

        const canvas = canvasRef.current;
        let ro: ResizeObserver | null = null;
        if (canvas && typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(schedule);
            ro.observe(canvas);
        }
        window.addEventListener("resize", schedule);
        window.addEventListener("orientationchange", schedule);
        const vv = (typeof window !== "undefined" && window.visualViewport) || null;
        vv?.addEventListener("resize", schedule);
        vv?.addEventListener("scroll", schedule);

        // body scroll lock + overscroll
        const prevOverflow = document.body.style.overflow;
        const prevOverscroll = document.body.style.overscrollBehavior;
        const prevTouchAction = document.body.style.touchAction;
        document.body.style.overflow = "hidden";
        document.body.style.overscrollBehavior = "contain";
        document.body.style.touchAction = "none";

        return () => {
            if (rafId !== null) window.cancelAnimationFrame(rafId);
            ro?.disconnect();
            window.removeEventListener("resize", schedule);
            window.removeEventListener("orientationchange", schedule);
            vv?.removeEventListener("resize", schedule);
            vv?.removeEventListener("scroll", schedule);
            document.body.style.overflow = prevOverflow;
            document.body.style.overscrollBehavior = prevOverscroll;
            document.body.style.touchAction = prevTouchAction;
        };
    }, [sizeCanvas]);

    // T-ML-004: native addEventListener + passive:false
    // React synthetic pointer events 預設註冊 passive listener，preventDefault 被 iOS Safari / Chrome 忽略 →
    // 觸控時 browser 先吃 touch (scroll/zoom)，handler 不會跑 → 觸控簽名失效。
    // 用 useEffect + native addEventListener({ passive: false }) 才能讓 preventDefault 生效。
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const getPos = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const handleDown = (e: PointerEvent) => {
            e.preventDefault();
            try {
                canvas.setPointerCapture(e.pointerId);
            } catch {
                // pointer may not be captureable on every browser
            }
            drawingRef.current = true;
            hasDrawnRef.current = true;
            const p = getPos(e);
            lastPointRef.current = p;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2);
                ctx.fillStyle = "#1f2937";
                ctx.fill();
                ctx.fillStyle = "#ffffff";
            }
        };

        const handleMove = (e: PointerEvent) => {
            if (!drawingRef.current) return;
            e.preventDefault();
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            const p = getPos(e);
            const last = lastPointRef.current;
            if (last) {
                ctx.beginPath();
                ctx.moveTo(last.x, last.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            lastPointRef.current = p;
        };

        const handleUp = (e: PointerEvent) => {
            drawingRef.current = false;
            lastPointRef.current = null;
            try {
                canvas.releasePointerCapture(e.pointerId);
            } catch {
                // pointer may already be released
            }
        };

        canvas.addEventListener("pointerdown", handleDown, { passive: false });
        canvas.addEventListener("pointermove", handleMove, { passive: false });
        canvas.addEventListener("pointerup", handleUp);
        canvas.addEventListener("pointercancel", handleUp);
        canvas.addEventListener("pointerleave", handleUp);

        return () => {
            canvas.removeEventListener("pointerdown", handleDown);
            canvas.removeEventListener("pointermove", handleMove);
            canvas.removeEventListener("pointerup", handleUp);
            canvas.removeEventListener("pointercancel", handleUp);
            canvas.removeEventListener("pointerleave", handleUp);
        };
    }, []);

    function handleClear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
        hasDrawnRef.current = false;
    }

    function handleDone() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dataUrl = canvas.toDataURL("image/png");
        onDone(dataUrl);
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/95 flex flex-col"
            role="dialog"
            aria-modal
            style={{ touchAction: "none" }}
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

            {/* canvas 區塊 */}
            <div className="flex-1 flex items-stretch justify-stretch px-3 pb-2 min-h-0">
                <canvas
                    ref={canvasRef}
                    className="flex-1 bg-white rounded-md touch-none"
                    style={{ touchAction: "none" }}
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
