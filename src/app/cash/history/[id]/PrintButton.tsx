"use client";

export default function PrintButton() {
    return (
        <button
            type="button"
            onClick={() => window.print()}
            className="text-sm border border-zinc-400 px-2 py-1 rounded hover:bg-white"
        >
            列印
        </button>
    );
}
