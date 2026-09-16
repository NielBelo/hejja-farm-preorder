"use client";

import { useSyncExternalStore } from "react";
import { dateFormatter, getPickupDateStatus } from "@/lib/pickupDateStatus";

export { getPickupDateStatus };

function subscribeToDate(onChange: () => void) {
    const interval = setInterval(onChange, 60_000);
    return () => clearInterval(interval);
}

const getServerSnapshot = () => null;

const getCurrentDate = () => dateFormatter.format(new Date());
const getServerDate = () => "";

export function useCurrentBudapestDate() {
    return useSyncExternalStore(subscribeToDate, getCurrentDate, getServerDate);
}

export function usePickupDateStatus(pickupDate: string) {
    return useSyncExternalStore(
        subscribeToDate,
        () => getPickupDateStatus(pickupDate),
        getServerSnapshot
    );
}
