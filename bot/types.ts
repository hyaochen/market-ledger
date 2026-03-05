// Bot 共用型別定義

export type ParsedEntry = {
    type: 'PURCHASE' | 'EXPENSE' | 'REVENUE';
    date: string;           // YYYY-MM-DD
    rawInput: string;       // 原始輸入行

    // 進貨
    itemId: string | null;
    itemName: string | null;
    vendorId: string | null;
    vendorName: string | null;
    quantity: number | null;
    unit: string | null;    // unit code（如 "台斤", "kg", "個"）

    // 支出
    expenseType: string | null;  // EXP001 等 value

    // 營業額
    locationId: string | null;
    locationName: string | null;

    // 通用
    price: number;
    note: string | null;

    // 解析信心度
    confident: boolean;
    uncertainReason: string | null;

    // 暫存：廠商候選清單（多廠商選擇時使用，不寫入 DB）
    _vendorCandidates?: { id: string; name: string }[];
    // 暫存：品項候選清單（多相似品項時使用，不寫入 DB）
    _itemCandidates?: { id: string; name: string }[];
};

export type SessionData = {
    userId: string;
    tenantId: string;
    username: string;
    realName: string | null;
    roleCode: string;
    tenantName: string;
    expires: string;  // ISO 8601
};

export type ChatPhase =
    | 'idle'
    | 'awaiting_auth'
    | 'awaiting_confirmation'
    | 'awaiting_duplicate_confirm'
    | 'awaiting_new_expense'        // 詢問是否新增支出項目
    | 'awaiting_new_purchase'       // 請使用者輸入正確品項名稱或選擇新增
    | 'awaiting_category_select'    // 等待使用者選擇品項分類（建立新品項中）
    | 'awaiting_vendor_decision'    // 等待廠商確認/選擇/新增
    | 'awaiting_new_vendor_input'   // 使用者輸入新廠商名稱（新增品項後）
    | 'awaiting_item_select';       // 等待使用者從相似品項中選擇

export type NewItemPending = {
    entry: ParsedEntry;               // 需要新增的那筆
    suggestedName: string;            // 推測的名稱
    confirmedItemName?: string;       // 使用者確認的名稱（等待選分類時使用）
    nextUncertain: ParsedEntry | null; // 建立完後繼續的不確定項目
};

export type ChatState = {
    phase: ChatPhase;
    pendingEntries: ParsedEntry[];   // 全部待寫入
    confirmedEntries: ParsedEntry[]; // 已確認可以寫入
    uncertainQueue: ParsedEntry[];   // 待逐一確認的不確信記錄
    currentUncertain: ParsedEntry | null;
    session: SessionData | null;
    newItemPending: NewItemPending | null;
};

export type DbContext = {
    tenantId: string;
    categories: { id: string; name: string }[];
    items: { id: string; name: string; categoryId: string; defaultUnit: string; categoryName: string }[];
    vendors: { id: string; name: string }[];
    expenseTypes: { id: string; value: string; label: string }[];
    units: { code: string; name: string; toKg?: number; isWeight?: boolean }[];
    locations: { id: string; name: string }[];
};
