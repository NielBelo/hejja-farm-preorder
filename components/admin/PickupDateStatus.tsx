"use client";

import { usePickupDateStatus } from "@/lib/usePickupDateStatus";

export default function PickupDateStatus({ pickupDate, orderStatus }: {
    pickupDate: string;
    orderStatus: string;
}) {
    const status = usePickupDateStatus(pickupDate);

    if (orderStatus === "cancelled") {
        return (
            <span className="shrink-0 rounded-md bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-600">
                Lemondva
            </span>
        );
    }

    if (status === null) return null;

    return (
        <span
            title="Az átvételi dátum alapján; nem igazolja a tényleges átvételt."
            className={`shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold ${
                status === "current"
                    ? "bg-green-100 text-green-800"
                    : "bg-yellow-100 text-yellow-800"
            }`}
        >
            {status === "current" ? "Aktuális" : "Teljesített"}
        </span>
    );
}
