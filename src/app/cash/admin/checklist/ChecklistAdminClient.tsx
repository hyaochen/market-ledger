"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    adminCreateChecklistItem,
    adminUpdateChecklistItem,
    adminDeleteChecklistItem,
} from "@/app/actions/cash";

type Item = {
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
};

export default function ChecklistAdminClient({ items }: { items: Item[] }) {
    const router = useRouter();
    const [name, setName] = useState("");
    const [sortOrder, setSortOrder] = useState("");
    const [isPending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Record<string, string>>({});

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
        if (!confirm("確定要停用此項目？歷史紀錄保留，未來清點不再顯示。")) return;
        startTransition(async () => {
            const res = await adminDeleteChecklistItem(id);
            if (res.success) router.refresh();
            else setError(res.error ?? "刪除失敗");
        });
    }

    return (
        <div className="space-y-3">
            <section className="border border-amber-200 bg-amber-50 rounded-md p-3 space-y-2">
                <h2 className="text-sm font-bold">新增項目</h2>
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="動作名稱"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="flex-1 border border-zinc-300 rounded px-2 py-1 text-sm"
                    />
                    <input
                        type="number"
                        placeholder="排序"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                        className="w-20 border border-zinc-300 rounded px-2 py-1 text-sm"
                    />
                    <button
                        type="button"
                        onClick={handleCreate}
                        disabled={isPending}
                        className="bg-amber-600 text-white px-3 py-1 text-sm rounded disabled:opacity-60"
                    >
                        新增
                    </button>
                </div>
                {error && <p className="text-xs text-red-700">{error}</p>}
            </section>

            <section>
                <h2 className="text-sm font-bold mb-2">目前清單</h2>
                <ul className="divide-y divide-zinc-200 border border-zinc-200 rounded-md bg-white">
                    {items.length === 0 && (
                        <li className="p-3 text-sm text-zinc-500">尚無項目。</li>
                    )}
                    {items.map((item) => (
                        <li key={item.id} className={`p-2 flex items-center gap-2 ${!item.isActive ? "bg-zinc-50 text-zinc-400" : ""}`}>
                            {editing[item.id] !== undefined ? (
                                <input
                                    type="text"
                                    value={editing[item.id]}
                                    onChange={(e) => setEditing((p) => ({ ...p, [item.id]: e.target.value }))}
                                    className="flex-1 border border-amber-400 rounded px-2 py-1 text-sm"
                                    autoFocus
                                />
                            ) : (
                                <span className="flex-1 text-sm">{item.name}</span>
                            )}
                            <input
                                type="number"
                                defaultValue={item.sortOrder}
                                onBlur={(e) => {
                                    if (Number(e.target.value) !== item.sortOrder) handleSortOrder(item.id, e.target.value);
                                }}
                                className="w-14 border border-zinc-300 rounded px-1 py-0.5 text-xs text-center"
                                title="排序"
                            />
                            {editing[item.id] !== undefined ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => handleRename(item.id)}
                                        className="text-xs text-green-700 underline"
                                    >
                                        儲存
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditing((p) => { const n = { ...p }; delete n[item.id]; return n; })}
                                        className="text-xs text-zinc-500 underline"
                                    >
                                        取消
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setEditing((p) => ({ ...p, [item.id]: item.name }))}
                                    className="text-xs text-amber-700 underline"
                                >
                                    編輯
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => handleToggleActive(item.id, item.isActive)}
                                className="text-xs underline"
                                title={item.isActive ? "停用" : "啟用"}
                            >
                                {item.isActive ? "🟢 啟用" : "⚪ 停用"}
                            </button>
                            {item.isActive && (
                                <button
                                    type="button"
                                    onClick={() => handleSoftDelete(item.id)}
                                    className="text-xs text-red-700 underline"
                                >
                                    軟刪
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
