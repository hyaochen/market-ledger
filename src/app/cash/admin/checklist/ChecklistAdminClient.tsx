"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, TriangleAlert, X } from "lucide-react";
import {
    adminCreateChecklistItem,
    adminUpdateChecklistItem,
    adminDeleteChecklistItem,
} from "@/app/actions/cash";
import CashConfirmDialog from "@/components/cash/CashConfirmDialog";
import { btn, CARD, chip, INPUT, notice } from "@/components/cash/ui";
import { cn } from "@/lib/utils";

type Item = {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
};

/**
 * 動作清單管理（T-ML-034 B4）。
 * 只重做版面與互動樣式，新增 / 改名 / 啟用停用 / 排序 / 刪除的呼叫與錯誤處理跟原本一樣。
 * 原本的 window.confirm 換成同一套確認對話框；「軟刪」這種工程師用語改成白話。
 */
export default function ChecklistAdminClient({ items }: { items: Item[] }) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [sortOrder, setSortOrder] = useState("");
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Record<string, string>>({});
    const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

    function handleCreate() {
        setError(null);
        if (!name.trim()) return setError("請填名稱");
        startTransition(async () => {
            const res = await adminCreateChecklistItem(name.trim(), Number(sortOrder) || 0);
            if (!res.success) setError(res.error ?? "新增失敗");
            else {
                setName("");
                setSortOrder("");
                router.refresh();
            }
        });
    }

    function handleRename(id: string) {
        const newName = editing[id]?.trim();
        if (!newName) return;
        startTransition(async () => {
            const res = await adminUpdateChecklistItem(id, { name: newName });
            if (res.success) {
                setEditing((p) => { const n = { ...p }; delete n[id]; return n; });
                router.refresh();
            } else {
                setError(res.error ?? "更新失敗");
            }
        });
    }

    function handleToggleActive(id: string, isActive: boolean) {
        startTransition(async () => {
            const res = await adminUpdateChecklistItem(id, { isActive: !isActive });
            if (res.success) router.refresh();
            else setError(res.error ?? "切換失敗");
        });
    }

    function handleSortOrder(id: string, value: string) {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        startTransition(async () => {
            const res = await adminUpdateChecklistItem(id, { sortOrder: n });
            if (res.success) router.refresh();
            else setError(res.error ?? "排序失敗");
        });
    }

    function handleSoftDelete(id: string) {
        startTransition(async () => {
            const res = await adminDeleteChecklistItem(id);
            setDeleteTarget(null);
            if (res.success) router.refresh();
            else setError(res.error ?? "刪除失敗");
        });
    }

    return (
        <div className="space-y-4">
            <section aria-labelledby="add-item-title" className={cn(CARD, "space-y-3 p-4")}>
                <h2 id="add-item-title" className="text-lg font-bold text-stone-900">新增項目</h2>
                <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
                    <label className="block">
                        <span className="mb-1 block text-[15px] font-bold text-stone-900">動作名稱</span>
                        <input
                            type="text"
                            placeholder="例：瓦斯關好"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={INPUT}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-[15px] font-bold text-stone-900">排序</span>
                        <input
                            type="number"
                            inputMode="numeric"
                            placeholder="0"
                            value={sortOrder}
                            onChange={(e) => setSortOrder(e.target.value)}
                            className={cn(INPUT, "text-center")}
                        />
                    </label>
                </div>
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isPending}
                    aria-busy={isPending}
                    className={btn("primary", "md", "w-full")}
                >
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    新增這個動作
                </button>
            </section>

            {error ? (
                <div role="alert" className={notice("bad")}>
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            ) : null}

            <section aria-labelledby="list-title" className={cn(CARD, "overflow-hidden")}>
                <h2 id="list-title" className="border-b border-stone-200 px-4 py-3 text-lg font-bold text-stone-900">
                    目前清單
                </h2>
                {items.length === 0 ? (
                    <p className="px-4 py-6 text-center text-base text-stone-700">還沒有任何動作，先在上面新增一個。</p>
                ) : (
                    <ul className="divide-y divide-stone-200">
                        {items.map((item) => {
                            const isEditing = editing[item.id] !== undefined;
                            return (
                                <li
                                    key={item.id}
                                    className={cn("space-y-3 px-4 py-3.5", !item.isActive && "bg-stone-50")}
                                >
                                    <div className="flex items-end justify-between gap-3">
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                aria-label="動作名稱"
                                                value={editing[item.id]}
                                                onChange={(e) => setEditing((p) => ({ ...p, [item.id]: e.target.value }))}
                                                className={cn(INPUT, "min-w-0 flex-1 border-amber-600")}
                                                autoFocus
                                            />
                                        ) : (
                                            <div className="min-w-0 flex-1 pb-2.5">
                                                <p className={cn("text-lg font-semibold", item.isActive ? "text-stone-900" : "text-stone-600")}>
                                                    {item.name}
                                                </p>
                                                {!item.isActive ? <span className={chip("muted", "mt-1")}>已停用</span> : null}
                                            </div>
                                        )}
                                        <label className="shrink-0 text-[13px] font-semibold text-stone-700">
                                            排序
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                defaultValue={item.sortOrder}
                                                onBlur={(e) => {
                                                    if (Number(e.target.value) !== item.sortOrder) handleSortOrder(item.id, e.target.value);
                                                }}
                                                className="mt-0.5 block h-12 w-16 rounded-xl border border-stone-500 bg-white px-1 text-center text-base text-stone-900"
                                            />
                                        </label>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {isEditing ? (
                                                <>
                                                    <button type="button" onClick={() => handleRename(item.id)} className={btn("primary", "sm")}>
                                                        <Check className="h-5 w-5" aria-hidden="true" />
                                                        儲存
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditing((p) => { const n = { ...p }; delete n[item.id]; return n; })}
                                                        className={btn("secondary", "sm")}
                                                    >
                                                        <X className="h-5 w-5" aria-hidden="true" />
                                                        取消
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setEditing((p) => ({ ...p, [item.id]: item.name }))}
                                                    className={btn("secondary", "sm")}
                                                >
                                                    <Pencil className="h-5 w-5" aria-hidden="true" />
                                                    改名
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={item.isActive}
                                                onClick={() => handleToggleActive(item.id, item.isActive)}
                                                className={cn(
                                                    btn("secondary", "sm"),
                                                    item.isActive ? "border-emerald-700 text-emerald-900" : "text-stone-800",
                                                )}
                                            >
                                                <span
                                                    aria-hidden="true"
                                                    className={cn(
                                                        "relative inline-block h-6 w-10 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                                                        item.isActive ? "bg-emerald-700" : "bg-stone-400",
                                                    )}
                                                >
                                                    <span
                                                        className={cn(
                                                            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-150 motion-reduce:transition-none",
                                                            item.isActive ? "left-[1.125rem]" : "left-0.5",
                                                        )}
                                                    />
                                                </span>
                                                {item.isActive ? "使用中" : "已停用"}
                                            </button>

                                            {item.isActive ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteTarget(item)}
                                                    aria-haspopup="dialog"
                                                    className={btn("secondary", "sm", "text-red-800")}
                                                >
                                                    刪除
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <CashConfirmDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                title={deleteTarget ? `刪除「${deleteTarget.name}」？` : "刪除這個動作？"}
                description="之後的清點表不會再出現這個動作。已經清點過的歷史紀錄會保留，需要時可以在這裡重新啟用。"
                confirmLabel="刪除"
                pendingLabel="刪除中…"
                tone="danger"
                pending={isPending}
                onConfirm={() => { if (deleteTarget) handleSoftDelete(deleteTarget.id); }}
            />
        </div>
    );
}
