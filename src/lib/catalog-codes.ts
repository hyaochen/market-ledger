/** 支出項目代碼：取現有 EXP### 的最大編號 + 1（刪除過項目也不會撞到既有代碼）。與 bot/index.ts 同一規則。 */
export function nextExpenseCode(existingValues: string[]): string {
    const maxNum = existingValues.reduce((max, v) => {
        const m = v.match(/EXP(\d+)/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    return `EXP${String(maxNum + 1).padStart(3, "0")}`;
}
