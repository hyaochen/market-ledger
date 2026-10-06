/**
 * 洪記軒現金清點的品牌小標誌：琥珀色底，中間是一枚方孔古錢。
 * 純裝飾（aria-hidden），旁邊一律有文字。inline SVG，不額外請求圖檔。
 */
export default function CashLogo({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <rect width="40" height="40" rx="10" fill="#b45309" />
            <circle cx="20" cy="20" r="11" stroke="#fffbeb" strokeWidth="2.5" />
            <rect x="15.5" y="15.5" width="9" height="9" rx="1.5" stroke="#fffbeb" strokeWidth="2.5" />
        </svg>
    );
}
