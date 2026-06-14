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

    // T-ML-010: URL ?debug=1 觸發 debug overlay，顯示 touch / rect / vv.offset / dpr
    // 給未來簽名座標問題用（不影響 production 體驗）
    const debug =
        typeof window !== "undefined" &&
        window.location.search.includes("debug=1");
    const [dbg, setDbg] = useState<string>("");

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

        // T-ML-011: revert T-ML-010 的 canvas.getBoundingClientRect monkey-patch。
        // owner 6/15 觀察「螢幕畫滿只佔簽名格一半」+「中心落差最大」鎖死 root cause =
        // manifest "orientation": "portrait-primary" 把 PWA 鎖在 portrait，user 橫握手機時
        // PWA 仍 portrait viewport（窄高）→ canvas CSS coords 跟 user 視覺橫向螢幕不一致 →
        // touch 中心對 portrait viewport 不是 canvas 中心 → 線性 scale mismatch 越中心落差越大。
        // vv offset patch 不是 root cause（只解 status bar offset、不解 scale mismatch）。
        // 解法在 cash-manifest.json 改 "any" 讓 PWA 跟著手機方向旋轉。

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
            // T-ML-013: WebKit canvas as flex-1 child intrinsic width 反饋 bug
            // owner 6/15 ?debug=1 量到 rect.width=2460 ≈ 橫向 viewport 1230 的 2 倍。
            // 原因：canvas.width = rect.width * dpr 後 WebKit 把 canvas DOM attribute width
            // 當作 layout intrinsic preferred size → 在 flex layout 嘗試撐到 intrinsic size
            // → 下次量 rect.width 又包含 inflated → 雙重 inflate 越跑越大。
            // 解法：(1) 用 parent rect 算 size、(2) 顯式設 canvas.style.width/.height
            // 鎖死 CSS 視覺大小、避免 WebKit intrinsic 反饋。
            const parent = canvas.parentElement;
            if (!parent) return;
            const parentRect = parent.getBoundingClientRect();
            const ps = window.getComputedStyle(parent);
            const w =
                parentRect.width -
                parseFloat(ps.paddingLeft) -
                parseFloat(ps.paddingRight) -
                parseFloat(ps.borderLeftWidth) -
                parseFloat(ps.borderRightWidth);
            const h =
                parentRect.height -
                parseFloat(ps.paddingTop) -
                parseFloat(ps.paddingBottom) -
                parseFloat(ps.borderTopWidth) -
                parseFloat(ps.borderBottomWidth);
            if (w <= 0 || h <= 0) return;

            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            // toData / fromData 保留筆觸，避免 resize 抹掉 user input
            const data = pad.toData();

            // 顯式設 CSS 視覺大小（鎖死 layout、避免 WebKit intrinsic 反饋）
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            canvas.width = w * ratio;
            canvas.height = h * ratio;

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

        // T-ML-010: debug overlay listener — URL ?debug=1 才 attach
        let debugPointerHandler: ((e: PointerEvent) => void) | null = null;
        if (debug) {
            debugPointerHandler = (e: PointerEvent) => {
                const r = canvas.getBoundingClientRect();
                const vv2 = window.visualViewport;
                setDbg(
                    `touch=(${e.clientX.toFixed(0)},${e.clientY.toFixed(0)}) rect=(${r.left.toFixed(0)},${r.top.toFixed(0)},${r.width.toFixed(0)}x${r.height.toFixed(0)}) vv.offset=(${vv2?.offsetLeft || 0},${vv2?.offsetTop || 0}) dpr=${window.devicePixelRatio}`,
                );
            };
            canvas.addEventListener("pointerdown", debugPointerHandler);
        }

        return () => {
            window.cancelAnimationFrame(rafId);
            vv?.removeEventListener("resize", resizeCanvas);
            vv?.removeEventListener("scroll", resizeCanvas);
            window.removeEventListener("orientationchange", resizeCanvas);
            if (debugPointerHandler) {
                canvas.removeEventListener("pointerdown", debugPointerHandler);
            }
            pad.off();
            padRef.current = null;
        };
    }, [initialValue, debug]);

    function handleClear() {
        padRef.current?.clear();
    }

    function handleDone() {
        const pad = padRef.current;
        const canvas = canvasRef.current;
        if (!pad || !canvas) return;

        // T-ML-012: 空白簽名 → 回傳 "" 不存爛 dataURL
        // owner 6/15 觀察：之前空白也回 toDataURL 會塞一張白 PNG，
        // CashCountForm 用 `!signature` 判斷，"" 跟 null 都 falsy → 行為一致
        if (pad.isEmpty()) {
            onDone("");
            return;
        }

        // T-ML-012: 偵測筆跡 bbox + crop 空白
        // owner 6/15 Discord「簽完的東西變得超級小」+ 截圖。Root cause =
        // pad.toDataURL 拿整個 canvas（橫向 modal 寬 1000-1200px、筆跡只佔中間 50px）
        // → 大量空白 → 縮到 thumbnail h-24 後筆跡只剩 2-3px。
        // 解法 = pixel scan 找非白邊界 → 重畫到新 canvas + padding → output。
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            onDone(pad.toDataURL("image/png"));
            return;
        }

        const W = canvas.width;
        const H = canvas.height;
        const imageData = ctx.getImageData(0, 0, W, H);
        const data = imageData.data;

        let minX = W;
        let minY = H;
        let maxX = -1;
        let maxY = -1;
        // 步進 2 加速：簽名筆跡寬度 1-3px、步進 2 仍可命中
        for (let y = 0; y < H; y += 2) {
            for (let x = 0; x < W; x += 2) {
                const i = (y * W + x) * 4;
                if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        // 找不到非白 pixel → 不裁切（保險，理論上 isEmpty=false 不會走到這）
        if (maxX < 0 || maxY < 0) {
            onDone(pad.toDataURL("image/png"));
            return;
        }

        // 補 padding：max(20, 短邊 3%)，避免 thumbnail 緊貼邊框難看
        const padding = Math.max(20, Math.round(Math.min(W, H) * 0.03));
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(W - 1, maxX + padding);
        maxY = Math.min(H - 1, maxY + padding);
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;

        // 重畫到新 canvas（白底）
        const tmp = document.createElement("canvas");
        tmp.width = cw;
        tmp.height = ch;
        const tmpCtx = tmp.getContext("2d");
        if (!tmpCtx) {
            onDone(pad.toDataURL("image/png"));
            return;
        }
        tmpCtx.fillStyle = "#ffffff";
        tmpCtx.fillRect(0, 0, cw, ch);
        tmpCtx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);

        onDone(tmp.toDataURL("image/png"));
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

            {/* T-ML-010: debug overlay — URL ?debug=1 觸發，顯示 touch / rect / vv.offset / dpr */}
            {debug && dbg && (
                <div className="fixed top-16 left-2 right-2 z-[60] bg-fuchsia-600 text-white text-[10px] px-2 py-1 rounded font-mono break-all">
                    {dbg}
                </div>
            )}

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
