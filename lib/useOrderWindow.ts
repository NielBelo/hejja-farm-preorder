"use client";

import { useSyncExternalStore } from "react";
import { getOrderWindowEnd } from "@/lib/orderWindow";

function subscribeToClock(onChange: () => void) {
    const interval = setInterval(onChange, 1000);
    return () => clearInterval(interval);
}

export function isWithinOrderWindow(startDate?: string | null, endDate?: string | null) {
    if (!startDate || !endDate) return false;

    const now = Date.now();
    const end = getOrderWindowEnd(endDate);

    return end !== null
        && now >= Date.parse(startDate)
        && now <= end.getTime();
}

// Keep server rendering and hydration consistent; check the window on the client.
const getServerSnapshot = () => false;

export function useOrderWindow(startDate?: string | null, endDate?: string | null) {
    return useSyncExternalStore(
        subscribeToClock,
        () => isWithinOrderWindow(startDate, endDate),
        getServerSnapshot
    );
}
