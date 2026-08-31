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

    return <>{isOrderingOpen
        ? seasonText
        : "Csirkéink átlagos vágott súlya szezononként változik, jellemzően 2–3 kg. Átvételkor a tényleges súly és az aktuális kilogrammonkénti ár alapján, a helyszínen számolunk el."}</>;
}
