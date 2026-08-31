"use client";

import { useSyncExternalStore } from "react";

function subscribeToClock(onChange: () => void) {
    const interval = setInterval(onChange, 1000);
    return () => clearInterval(interval);
}

export function isWithinOrderWindow(startDate?: string | null, endDate?: string | null) {
    if (!startDate || !endDate) return false;

    const now = Date.now();
    return now >= Date.parse(startDate) && now <= Date.parse(endDate);
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
