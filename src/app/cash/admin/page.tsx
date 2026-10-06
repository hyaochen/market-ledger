import { redirect } from "next/navigation";

/**
 * /cash/admin 本身沒有內容頁，「管理」分頁預設進異常清單。
 * 非管理者在上一層的 admin layout（requireCashAdmin）就會被導回 /cash，不會走到這裡。
 */
export default function CashAdminIndexPage() {
    redirect("/cash/admin/alerts");
}
