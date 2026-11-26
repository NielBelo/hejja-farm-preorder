"use client";

import { usePickupDateStatus } from "@/lib/usePickupDateStatus";

export default function PickupDateStatus({ pickupDate, orderStatus }: {
    pickupDate: string;
    orderStatus: string;
}) {
    const status = usePickupDateStatus(pickupDate);

    if (orderStatus === "cancelled") {
        return (
            <span className="shrink-0 rounded-md bg-[#FCEEEE] px-2.5 py-1 text-sm font-semibold text-[#C83D3D]">
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
                    ? "bg-[#E0EED4] text-[#477D35]"
                    : "bg-[#FBF3E4] text-[#8F5A10]"
            }`}
        >
            {status === "current" ? "Aktuális" : "Teljesített"}
        </span>
    );
}
