import type { FocusEvent } from "react";

/**
 * 輸入框聚焦時全選（方便直接蓋掉原本的數字）。
 *
 * - iOS Safari 要等一個 frame 才能真的全選，所以用 requestAnimationFrame。
 * - 注意 select() 在 Chrome / Safari 都會把焦點「搶回」該欄位：如果這一幀執行時焦點
 *   已經移到別的欄位（快速連續輸入、鍵盤快速 Tab），舊的 callback 會把焦點拉回去、
 *   讓接下來的字打進錯的欄位。所以只有「焦點還在這個欄位」才全選。
 */
export function selectOnFocus(e: FocusEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    requestAnimationFrame(() => {
        if (document.activeElement === el) el.select();
    });
}
