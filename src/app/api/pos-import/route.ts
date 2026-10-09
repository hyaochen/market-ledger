// POST /api/pos-import
//
// 接收 yjc-sync 的批次檔，把 POS 資料鏡像進獨立的 yjc.db（見 src/lib/yjc-db.ts）。
//
// 驗證：Authorization: Bearer <POS_IMPORT_TOKEN>。這條路徑沒有登入 session，所以：
//   - 環境變數沒設 -> 一律 503（不要因為忘了設而變成開放）
//   - token 不符 -> 401，用 constant-time 比對
//   - 回應與日誌都不印 token
//
// 這支 handler 會經 Cloudflare tunnel 對外，body 最大約數 MB；middleware.ts 的 matcher
// 已排除本路徑，避免 Next 為了 middleware 去緩衝 request body。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PosImportError, applyOps, parseOps } from "@/lib/yjc-db";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

function sha256(s: string): Buffer {
    return createHash("sha256").update(s, "utf8").digest();
}

function tokenMatches(provided: string, expected: string): boolean {
    // 先雜湊成等長，再 timingSafeEqual：長度差異也不會洩漏
    return timingSafeEqual(sha256(provided), sha256(expected));
}

export async function POST(req: NextRequest) {
    const expected = process.env.POS_IMPORT_TOKEN;
    if (!expected) {
        return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
    }

    const auth = req.headers.get("authorization") || "";
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m || !tokenMatches(m[1].trim(), expected)) {
        return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY_BYTES) {
        return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
    }

    try {
        const ops = parseOps(body);
        const result = applyOps(ops);
        return NextResponse.json({ ok: true, ops: result.ops, rows: result.rows });
    } catch (err) {
        if (err instanceof PosImportError) {
            return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
        }
        // 交易已整個 rollback。細節只進 server log
        console.error("[pos-import] failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ ok: false, error: "import failed" }, { status: 500 });
    }
}
