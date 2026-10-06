/**
 * cash 站共用的樣式 token（T-ML-034）。
 *
 * 為什麼用函式 + 常數而不是做一組 Button/Card 元件：
 * - server component（歷史列表的整張卡片連結）與 client component 都要用，純字串兩邊都能用。
 * - 所有按鈕/輸入框的尺寸、顏色集中在這一個檔，之後要微調（例如主色再加深）只改一處。
 *
 * 設計約定：
 * - 觸控區：一般按鈕 >= 44px（sm）、主要輸入與按鈕 >= 48px（md）、主要提交 >= 52px（lg 為 56px）
 * - 主按鈕 amber-700 + 白字（對比約 5.0:1，>= 4.5:1）；危險 red-700；成功 emerald-700；提示 sky-700
 * - 焦點樣式由 globals.css 的 `.cash-app :focus-visible` 統一提供，這裡不重複寫 ring
 * - 動畫 150ms，並尊重 prefers-reduced-motion
 */
import { cn } from "@/lib/utils";

export type BtnVariant = "primary" | "secondary" | "danger" | "danger-outline" | "ghost";
export type BtnSize = "sm" | "md" | "lg";

const BTN_BASE =
    "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-xl font-bold " +
    "transition-colors duration-150 motion-reduce:transition-none " +
    "disabled:cursor-not-allowed disabled:opacity-60";

const BTN_SIZES: Record<BtnSize, string> = {
    sm: "min-h-11 px-4 text-[15px]",
    md: "min-h-12 px-5 text-base",
    lg: "min-h-14 px-6 text-lg",
};

const BTN_VARIANTS: Record<BtnVariant, string> = {
    primary: "bg-amber-700 text-white hover:bg-amber-800 active:bg-amber-900",
    secondary: "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100 active:bg-stone-200",
    danger: "bg-red-700 text-white hover:bg-red-800 active:bg-red-900",
    "danger-outline": "border-2 border-red-700 bg-white text-red-800 hover:bg-red-50 active:bg-red-100",
    ghost: "text-amber-900 hover:bg-amber-100 active:bg-amber-200",
};

export function btn(variant: BtnVariant = "primary", size: BtnSize = "md", className?: string): string {
    return cn(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className);
}

/** 單行文字輸入框：高 48px、字級 16px（iOS 聚焦時才不會自動放大）。 */
export const INPUT =
    "h-12 w-full rounded-xl border border-stone-300 bg-white px-3 text-base text-stone-900 " +
    "placeholder:text-stone-500 disabled:bg-stone-100 disabled:text-stone-600";

/** 白底卡片：圓角 2xl、細邊框、淡陰影。卡片內不再巢狀卡片，用分隔線切區。 */
export const CARD = "rounded-2xl border border-stone-200 bg-white shadow-sm";

export type Tone = "ok" | "bad" | "warn" | "info" | "muted";

const TONES: Record<Tone, string> = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
    bad: "border-red-300 bg-red-50 text-red-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
    muted: "border-stone-300 bg-stone-100 text-stone-800",
};

/** 小徽章（狀態一律「文字 + 圖示 + 顏色」，不只靠顏色）。 */
export function chip(tone: Tone, className?: string): string {
    return cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold", TONES[tone], className);
}

/** 整塊提示（成功/錯誤/資訊）。 */
export function notice(tone: Tone, className?: string): string {
    return cn("flex items-start gap-2.5 rounded-xl border p-3.5 text-base", TONES[tone], className);
}
