"use client";

import { useOrderWindow } from "@/lib/useOrderWindow";

export default function SeasonOrderInfo({
    startDate,
    endDate,
    seasonText,
    fallbackText,
}: {
    startDate?: string | null;
    endDate?: string | null;
    seasonText?: string | null;
    // A rendelési időablakon kívül mutatott szöveg (a szezon súly- és ársávjával).
    fallbackText?: string | null;
}) {
    const isOrderingOpen = useOrderWindow(startDate, endDate);
    const text = isOrderingOpen ? seasonText : fallbackText;

    if (!text) {
        return null;
    }

    const highlightedText = text
        .split(/(\d+(?:[.,]\d+)?\s*[–-]\s*\d+(?:[.,]\d+)?\s*kg|\d[\d\s]*\s*Ft\/kg)/gi)
        .map((part, index) =>
            /(?:kg|Ft\/kg)$/i.test(part.trim()) ? (
                <span key={index} className="text-[#43852D]">
                    {part}
                </span>
            ) : (
                part
            ),
        );

    return <>{highlightedText}</>;
}
