"use client";

import { useSyncExternalStore } from "react";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
});

export function getPickupDateStatus(pickupDate: string) {
    const pickup = new Date(pickupDate);
    if (Number.isNaN(pickup.getTime())) return null;

    // The pickup remains current throughout its calendar day in Hungary.
    return dateFormatter.format(pickup) < dateFormatter.format(new Date())
        ? "past"
        : "current";
}

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
