"use client";

import { Printer } from "lucide-react";
import { btn } from "@/components/cash/ui";

export default function PrintButton() {
    return (
        <button type="button" onClick={() => window.print()} className={btn("secondary", "md")}>
            <Printer className="h-5 w-5" aria-hidden="true" />
            列印
        </button>
    );
}
