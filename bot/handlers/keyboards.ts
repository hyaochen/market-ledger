// 內嵌鍵盤（inline keyboard）建構器

export type KeyboardMarkup = { inline_keyboard: { text: string; callback_data: string }[][] };

// ── 確認鍵盤 ────────────────────────────────────────────────────
export const CONFIRM_KEYBOARD = (_action: 'yes' | 'no', idx: number) => ({
    inline_keyboard: [[
        { text: '是，正確', callback_data: `confirm_yes_${idx}` },
        { text: '不是，跳過', callback_data: `confirm_no_${idx}` },
    ]],
});

export const NEW_ITEM_KEYBOARD = {
    inline_keyboard: [[
        { text: '是，新增', callback_data: 'new_item_yes' },
        { text: '否，略過', callback_data: 'new_item_no' },
    ]],
};

// ── 建立支出類型選擇鍵盤 ────────────────────────────────────────
export function buildExpenseTypeKeyboard(expenseTypes: { value: string; label: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < expenseTypes.length; i += 2) {
        rows.push(expenseTypes.slice(i, i + 2).map(et => ({
            text: et.label,
            callback_data: `expense_type_select_${et.value}`,
        })));
    }
    rows.push([{ text: '新增支出類型', callback_data: 'new_expense_create' }]);
    rows.push([{ text: '略過', callback_data: 'new_item_no' }]);
    return { inline_keyboard: rows };
}

// 找不到品項時，詢問類型的鍵盤
export const UNKNOWN_ITEM_KEYBOARD = {
    inline_keyboard: [
        [
            { text: '新增為進貨品項', callback_data: 'new_purchase_create' },
            { text: '新增為支出費用', callback_data: 'new_expense_create' },
        ],
        [{ text: '略過', callback_data: 'new_item_no' }],
    ],
};

// ── 建立廠商選擇鍵盤 ─────────────────────────────────────────
// allowCreate=true：加入「新增廠商」按鈕（新建品項後使用）
export function buildVendorKeyboard(vendors: { id: string; name: string }[], allowCreate = false) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < vendors.length; i += 2) {
        rows.push(vendors.slice(i, i + 2).map(v => ({
            text: v.name,
            callback_data: `vendor_select_${v.id}`,
        })));
    }
    if (allowCreate) {
        rows.push([{ text: '新增廠商', callback_data: 'vendor_create_prompt' }]);
    }
    rows.push([{ text: '不填廠商', callback_data: 'vendor_skip' }]);
    return { inline_keyboard: rows };
}

// ── 建立品項選擇鍵盤（多相似品項時使用）────────────────────────
export function buildItemKeyboard(items: { id: string; name: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < items.length; i += 2) {
        rows.push(items.slice(i, i + 2).map(item => ({
            text: item.name,
            callback_data: `item_select_${item.id}`,
        })));
    }
    rows.push([{ text: '新增品項', callback_data: 'new_purchase_create' }]);
    rows.push([{ text: '略過', callback_data: 'new_item_no' }]);
    return { inline_keyboard: rows };
}

// ── 建立分類鍵盤 ────────────────────────────────────────────
export function buildCategoryKeyboard(categories: { id: string; name: string }[]) {
    const rows: { text: string; callback_data: string }[][] = [];
    // 每行最多 3 個按鈕
    for (let i = 0; i < categories.length; i += 3) {
        rows.push(categories.slice(i, i + 3).map(c => ({
            text: c.name,
            callback_data: `cat_select_${c.id}`,
        })));
    }
    rows.push([{ text: '取消', callback_data: 'new_item_no' }]);
    return { inline_keyboard: rows };
}

// ── 意圖釐清鍵盤（有日期但看不出是查詢還是記帳時使用）────────────
export const INTENT_CLARIFY_KEYBOARD = {
    inline_keyboard: [[
        { text: '查詢', callback_data: 'intent_query' },
        { text: '記帳', callback_data: 'intent_entry' },
    ]],
};
