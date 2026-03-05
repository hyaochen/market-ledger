"use client";

import { useEffect } from "react";

// 每次分類切換或進入頁面時，強制捲動到頂端
export default function ScrollToTop({ id }: { id: string }) {
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [id]);
    return null;
}
