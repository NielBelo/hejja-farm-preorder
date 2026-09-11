"use client";

import { useOrderWindow } from "@/lib/useOrderWindow";

export default function SeasonOrderInfo({
    startDate,
    endDate,
    seasonText,
}: {
    startDate?: string | null;
    endDate?: string | null;
    seasonText?: string | null;
}) {
    const isOrderingOpen = useOrderWindow(startDate, endDate);
    const text = isOrderingOpen
        ? seasonText
        : "Csirkéink átlagos vágott súlya szezononként változik, jellemzően 2–3 kg. Átvételkor a tényleges súly és az aktuális kilogrammonkénti ár alapján, a helyszínen számolunk el.";

    if (!text) {
        return null;
    }

    const highlightedText = text
        .split(/(\d+(?:[.,]\d+)?\s*[–-]\s*\d+(?:[.,]\d+)?\s*kg|\d[\d\s]*\s*Ft\/kg)/gi)
        .map((part, index) =>
            /(?:kg|Ft\/kg)$/i.test(part.trim()) ? (
                <span key={index} className="font-extrabold text-[rgb(22,120,62)]">
                    {part}
                </span>
            ) : (
                part
            ),
        );

    return <>{highlightedText}</>;
}
