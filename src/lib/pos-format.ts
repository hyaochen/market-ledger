// POS 頁面共用的顯示格式。

export function fmtMoney(n: number | null | undefined): string {
    const v = Math.round(Number(n) || 0);
    return (v === 0 ? 0 : v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
    return (Number(n) || 0).toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });
}

/** 'YYYY-MM-DD HH:MM:SS.mmm' -> 'HH:MM:SS' */
export function fmtSaleTime(s: string | null | undefined): string {
    if (!s) return "";
    const m = /(\d{2}:\d{2}:\d{2})/.exec(s);
    return m ? m[1] : s;
}

export function fmtDateTimeTaipei(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(d);
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
}

export function parsePage(v: string | undefined): number {
    const n = Number.parseInt(v ?? "1", 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : 1;
}
