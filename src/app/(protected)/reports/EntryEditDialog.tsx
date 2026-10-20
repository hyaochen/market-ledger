"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type UnitDef } from "@/lib/units";
import { type ReportsClientProps, type EntryRow } from "./reports-types";
import { CalendarPicker } from "./CalendarPicker";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    form: EntryRow | null;
    setForm: (form: EntryRow | null) => void;
    loading: boolean;
    onSave: () => void;
    items: ReportsClientProps["items"];
    vendors: ReportsClientProps["vendors"];
    expenseTypes: ReportsClientProps["expenseTypes"];
    units: UnitDef[];
};

export function EntryEditDialog({ open, onOpenChange, form: entryForm, setForm: setEntryForm, loading: entryLoading, onSave: handleEntrySave, items, vendors, expenseTypes, units }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>編輯記錄</DialogTitle>
                </DialogHeader>
                {entryForm && (
                    <div className="space-y-4">
                        <CalendarPicker
                            label="日期"
                            value={entryForm.date}
                            onChange={(date) => setEntryForm({ ...entryForm, date })}
                        />
                        {entryForm.type === "PURCHASE" ? (
                            <>
                                <div className="space-y-2">
                                    <Label>品項</Label>
                                    <Select value={entryForm.itemId} onValueChange={(value) => setEntryForm({ ...entryForm, itemId: value })}>
                                        <SelectTrigger><SelectValue placeholder="選擇品項" /></SelectTrigger>
                                        <SelectContent>
                                            {items.map((item) => (
                                                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>廠商</Label>
                                    <Select
                                        value={entryForm.vendorId || "none"}
                                        onValueChange={(value) => setEntryForm({ ...entryForm, vendorId: value === "none" ? "" : value })}
                                    >
                                        <SelectTrigger><SelectValue placeholder="選擇廠商" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">未指定</SelectItem>
                                            {vendors.map((vendor) => (
                                                <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>數量</Label>
                                        <Input
                                            type="number"
                                            value={entryForm.inputQuantity}
                                            onChange={(e) => {
                                                const value = Number.parseFloat(e.target.value);
                                                setEntryForm({ ...entryForm, inputQuantity: Number.isFinite(value) ? value : 0 });
                                            }}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>單位</Label>
                                        <Select value={entryForm.inputUnit} onValueChange={(value) => setEntryForm({ ...entryForm, inputUnit: value })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {units.map((unit) => (
                                                    <SelectItem key={unit.code} value={unit.code}>{unit.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>總金額 (TWD)</Label>
                                    <Input
                                        type="number"
                                        value={entryForm.totalPrice}
                                        onChange={(e) => {
                                            const value = Number.parseFloat(e.target.value);
                                            setEntryForm({ ...entryForm, totalPrice: Number.isFinite(value) ? value : 0 });
                                        }}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>支出項目</Label>
                                    <Select value={entryForm.expenseType} onValueChange={(value) => setEntryForm({ ...entryForm, expenseType: value })}>
                                        <SelectTrigger><SelectValue placeholder="選擇支出" /></SelectTrigger>
                                        <SelectContent>
                                            {expenseTypes.map((item) => (
                                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>金額 (TWD)</Label>
                                    <Input
                                        type="number"
                                        value={entryForm.totalPrice}
                                        onChange={(e) => {
                                            const value = Number.parseFloat(e.target.value);
                                            setEntryForm({ ...entryForm, totalPrice: Number.isFinite(value) ? value : 0 });
                                        }}
                                    />
                                </div>
                            </>
                        )}
                        <div className="space-y-2">
                            <Label>備註</Label>
                            <Input
                                value={entryForm.note}
                                onChange={(e) => setEntryForm({ ...entryForm, note: e.target.value })}
                            />
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <Button onClick={handleEntrySave} disabled={entryLoading}>
                        {entryLoading ? "儲存中..." : "儲存"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
