"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Props = {
    label: string;
    value: string | null;
    onChange: (dataUrl: string | null) => void;
};

/**
 * Signature pad with dblclick-to-fullscreen-landscape modal.
 *
 * 操作流程：
 * 1. 預設顯示 placeholder（「✍ 點兩下開始簽名」）或已存的簽名縮圖
 * 2. 雙擊 → 全螢幕 modal（CSS rotate 90deg 模擬橫向）
 * 3. canvas pointer events 觸控繪圖
 * 4. 「完成」→ toDataURL → onChange dataURL + 關閉 modal
 */
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
                    // Touch 裝置雙擊有時收不到 dblclick — 單擊也讓使用者進
                    // 但只在沒簽過時自動開（避免誤觸清掉）
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

    const sizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = "#1f2937";
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, rect.width, rect.height);

            // 還原既有簽名
            if (initialValue) {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, 0, rect.width, rect.height);
                };
                img.src = initialValue;
            }
        }
    }, [initialValue]);

    useEffect(() => {
        sizeCanvas();
        const onResize = () => sizeCanvas();
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onResize);
        };
    }, [sizeCanvas]);

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
        e.preventDefault();
        canvasRef.current?.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        lastPointRef.current = getPos(e);
    }

    function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
        if (!drawingRef.current) return;
        e.preventDefault();
        const ctx = canvasRef.current?.getContext("2d");
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
    }

    function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
        drawingRef.current = false;
        lastPointRef.current = null;
        canvasRef.current?.releasePointerCapture(e.pointerId);
    }

    function handleClear() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
    }

    function handleDone() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dataUrl = canvas.toDataURL("image/png");
        onDone(dataUrl);
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            role="dialog"
            aria-modal
        >
            <div className="absolute inset-0 flex flex-col items-stretch p-4">
                <div className="text-white text-center text-sm mb-2">
                    {label}：請於下方簽名（手指或筆觸控繪製）
                </div>
                <div className="flex-1 flex items-stretch justify-stretch">
                    <canvas
                        ref={canvasRef}
                        className="flex-1 bg-white rounded-md touch-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                    />
                </div>
                <div className="mt-3 flex gap-2 justify-end">
                    <button
                        type="button"
                        onClick={handleClear}
                        className="px-4 py-2 bg-zinc-600 text-white rounded-md text-sm"
                    >
                        清除重簽
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-zinc-700 text-white rounded-md text-sm"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleDone}
                        className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-semibold"
                    >
                        完成
                    </button>
                </div>
            </div>
        </div>
    );
}
