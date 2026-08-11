// GET /api/health
//
// T-ML-030：真的會碰 DB 的健康檢查端點。2026-08-11 事故（見
// vault/projects/market-ledger/bugs-log.md）證明「登入頁回 200」不代表 DB 可用
// —— SQLite WAL 在 Windows bind mount 上可能出現 stale file handle，靜態頁完全
// 看不出來，靜默停擺 35 小時沒人發現。這支端點存在的唯一理由就是不能重演那件事，
// 所以「輕量但真的查 DB」是硬性要求，回靜態 {ok:true} 等於沒做。
//
// 🔴 這支端點會經 Cloudflare tunnel 對外公開，且刻意不掛 requireTenant()/
// getCurrentUser()（監控要能直接打，不能卡登入）：
//   - 絕對不可回傳任何營業資料、筆數、金額、租戶資訊
//   - 錯誤訊息不可含檔案路徑、DB 路徑或 stack trace —— 只回固定字串 "db"
//
// force-dynamic：這個 handler 沒有讀 cookies/headers/searchParams，若不強制
// dynamic，Next.js 可能在 build 時把它當成可靜態化的 route 快取住，那就會變成
// 跟這次事故同樣的「看起來 200 但沒有真的查」。
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({ ok: true }, { status: 200 });
    } catch {
        // 刻意不把 err 內容（可能含檔案路徑）放進回應
        return NextResponse.json({ ok: false, error: "db" }, { status: 503 });
    }
}
