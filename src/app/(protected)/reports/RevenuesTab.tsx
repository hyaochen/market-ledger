"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { formatPrice } from "@/lib/units";
import { type RevenueRow } from "./reports-types";

type Props = {
    revenues: RevenueRow[];
    canEdit: boolean;
    revenueDeleting: string | null;
    openRevenueEditor: (record: RevenueRow) => void;
    handleRevenueDelete: (recordId: string) => void;
};

export function RevenuesTab({ revenues, canEdit, revenueDeleting, openRevenueEditor, handleRevenueDelete }: Props) {
    return (
            <TabsContent value="revenues" className="space-y-2 mt-3">
                {revenues.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            尚無營收紀錄。
                        </CardContent>
                    </Card>
                ) : (
                    revenues.map((record) => (
                        <Card
                            key={record.id}
                            className={`hover:shadow-sm transition-shadow ${record.isDayOff ? "bg-muted/40 border-dashed" : ""}`}
                        >
                            <CardContent className="p-3 sm:p-4 space-y-2.5">
                                {/* Row 1: Badge + Location + Amount */}
                                <div className="flex items-start gap-3">
                                    <div
                                        className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${
                                            record.isDayOff
                                                ? "bg-muted text-muted-foreground"
                                                : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                                        }`}
                                        title={record.isDayOff ? "休假日（不列入日均）" : "營業日"}
                                    >
                                        {record.isDayOff ? "休" : "營"}
                                    </div>
                                    <div className="flex-1 min-w-0 flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
                                        <span className={`font-semibold break-words ${record.isDayOff ? "text-muted-foreground" : ""}`}>
                                            {record.locationName}
                                        </span>
                                        <span
                                            className={`font-bold text-lg whitespace-nowrap ${
                                                record.isDayOff ? "text-muted-foreground italic" : "text-primary"
                                            }`}
                                        >
                                            {record.isDayOff ? "休假" : formatPrice(record.amount)}
                                        </span>
                                    </div>
                                </div>

                                {/* Row 2: Date */}
                                <div className="text-xs text-muted-foreground pl-[52px]">{record.date}</div>

                                {/* Row 3: Actions */}
                                {canEdit && (
                                    <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                                        <Button variant="outline" size="sm" onClick={() => openRevenueEditor(record)}>
                                            編輯
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive"
                                            disabled={revenueDeleting === record.id}
                                            onClick={() => handleRevenueDelete(record.id)}
                                        >
                                            {revenueDeleting === record.id ? "處理中..." : "刪除"}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))
                )}
            </TabsContent>
    );
}
