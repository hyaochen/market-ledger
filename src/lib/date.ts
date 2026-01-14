export function parseLocalDate(value?: string | null): Date | null {
    if (!value) return null;
    const parts = value.split('-').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3) return null;
    const [year, month, day] = parts;
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

export function formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function formatDateKey(date: Date): string {
    return formatDateInput(date);
}
