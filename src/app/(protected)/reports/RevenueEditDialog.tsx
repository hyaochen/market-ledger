"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type RevenueRow } from "./reports-types";
import { CalendarPicker } from "./CalendarPicker";

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    form: RevenueRow | null;
    setForm: (form: RevenueRow | null) => void;
    loading: boolean;
    onSave: () => void;
};

export function RevenueEditDialog({ open, onOpenChange, form: revenueForm, setForm: setRevenueForm, loading: revenueLoading, onSave: handleRevenueSave }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>編輯營收</DialogTitle>
                </DialogHeader>
                {revenueForm && (
                    <div className="space-y-4">
                        <CalendarPicker
                            label="日期"
                            value={revenueForm.date}
                            onChange={(date) => setRevenueForm({ ...revenueForm, date })}
                        />
                        <div className="space-y-2">
                            <Label>金額 (TWD)</Label>
                            <Input
                                type="number"
                                value={revenueForm.amount}
                                disabled={revenueForm.isDayOff}
                                onChange={(e) => {
                                    const value = Number.parseFloat(e.target.value);
                                    setRevenueForm({ ...revenueForm, amount: Number.isFinite(value) ? value : 0 });
                                }}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="edit-dayoff"
                                className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={revenueForm.isDayOff}
                                onChange={(e) => setRevenueForm({ ...revenueForm, isDayOff: e.target.checked })}
                            />
                            <Label htmlFor="edit-dayoff">此日休假</Label>
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <Button onClick={handleRevenueSave} disabled={revenueLoading}>
                        {revenueLoading ? "儲存中..." : "儲存"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
