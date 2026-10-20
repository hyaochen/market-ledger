"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

export function CalendarPicker({
    value,
    onChange,
    label,
    minDate,
}: {
    value: string;
    onChange: (date: string) => void;
    label: string;
    minDate?: string;
}) {
    const [open, setOpen] = useState(false);
    const [viewYear, setViewYear] = useState(() => {
        const d = value ? new Date(value + "T00:00:00") : new Date();
        return d.getFullYear();
    });
    const [viewMonth, setViewMonth] = useState(() => {
        const d = value ? new Date(value + "T00:00:00") : new Date();
        return d.getMonth();
    });

    // Use local date format (not UTC) to avoid timezone offset issues
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();

    const displayDate = value
        ? (() => {
            const d = new Date(value + "T00:00:00");
            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
        })()
        : "選擇日期";

    const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

    const handleSelect = (day: number) => {
        const selected = fmt(new Date(viewYear, viewMonth, day));
        onChange(selected);
        setOpen(false);
    };

    const prevMonth = () => {
        if (viewMonth === 0) {
            setViewYear(viewYear - 1);
            setViewMonth(11);
        } else {
            setViewMonth(viewMonth - 1);
        }
    };

    const nextMonth = () => {
        if (viewMonth === 11) {
            setViewYear(viewYear + 1);
            setViewMonth(0);
        } else {
            setViewMonth(viewMonth + 1);
        }
    };

    const isSelected = (day: number) => {
        if (!value) return false;
        return value === fmt(new Date(viewYear, viewMonth, day));
    };

    const isToday = (day: number) => {
        const today = new Date();
        return (
            today.getFullYear() === viewYear &&
            today.getMonth() === viewMonth &&
            today.getDate() === day
        );
    };

    return (
        <div className="relative">
            <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full h-12 px-4 rounded-lg border border-input bg-background text-base font-medium hover:bg-accent/50 transition-colors active:scale-[0.98]"
            >
                <span className={value ? "" : "text-muted-foreground"}>{displayDate}</span>
                <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute z-50 top-full left-0 mt-2 w-full min-w-[280px] bg-background border border-border rounded-xl shadow-lg p-3 animate-in fade-in zoom-in-95 duration-150">
                        {/* Month/Year Header */}
                        <div className="flex items-center justify-between mb-3">
                            <button
                                type="button"
                                onClick={prevMonth}
                                className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent active:scale-95 transition-all"
                            >
                                ‹
                            </button>
                            <span className="text-sm font-semibold">
                                {viewYear} 年 {viewMonth + 1} 月
                            </span>
                            <button
                                type="button"
                                onClick={nextMonth}
                                className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent active:scale-95 transition-all"
                            >
                                ›
                            </button>
                        </div>

                        {/* Weekday Headers */}
                        <div className="grid grid-cols-7 gap-0.5 mb-1">
                            {weekDays.map((d) => (
                                <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">
                                    {d}
                                </div>
                            ))}
                        </div>

                        {/* Day Grid */}
                        <div className="grid grid-cols-7 gap-0.5">
                            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                                <div key={`empty-${i}`} />
                            ))}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const selected = isSelected(day);
                                const today = isToday(day);
                                return (
                                    <button
                                        key={day}
                                        type="button"
                                        onClick={() => handleSelect(day)}
                                        className={[
                                            "h-9 w-full rounded-lg text-sm font-medium transition-all active:scale-90",
                                            selected
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : today
                                                    ? "bg-accent text-accent-foreground font-bold"
                                                    : "hover:bg-accent/60",
                                        ].join(" ")}
                                    >
                                        {day}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Quick Jump to Today */}
                        <button
                            type="button"
                            onClick={() => {
                                const now = new Date();
                                setViewYear(now.getFullYear());
                                setViewMonth(now.getMonth());
                                handleSelect(now.getDate());
                            }}
                            className="w-full mt-2 h-8 text-xs text-primary hover:bg-accent rounded-lg transition-colors"
                        >
                            今天
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
