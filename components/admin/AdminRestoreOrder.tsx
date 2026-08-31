"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPickupDateStatus, usePickupDateStatus } from "@/lib/usePickupDateStatus";

export default function AdminRestoreOrder({ orderId, pickupDate, disabled }: {
    orderId: number;
    pickupDate: string;
    disabled: boolean;
}) {
    const router = useRouter();
    const requestInFlight = useRef(false);
    const [isRestoring, setIsRestoring] = useState(false);
    const [isRestored, setIsRestored] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pickupStatus = usePickupDateStatus(pickupDate);
    const cannotRestore = disabled || isRestoring || isRestored || pickupStatus !== "current";

    const handleRestore = async () => {
        if (disabled || requestInFlight.current || isRestored) return;
        if (getPickupDateStatus(pickupDate) !== "current") {
            setError("Elmúlt vagy érvénytelen átvételi dátumú rendelés nem állítható vissza.");
            return;
        }

        requestInFlight.current = true;
        setIsRestoring(true);
        setError(null);
        try {
            const { error: restoreError } = await createClient().rpc("restore_order", {
                p_order_id: orderId,
            });
            if (restoreError) {
                setError(restoreError.message || "A rendelés visszaállítása sikertelen.");
                return;
            }
            setIsRestored(true);
            router.refresh();
        } catch {
            setError("A rendelés visszaállítása sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
        } finally {
            requestInFlight.current = false;
            setIsRestoring(false);
        }
    };

    return (
        <div>
            <button
                type="button"
                onClick={handleRestore}
                disabled={cannotRestore}
                title={pickupStatus === "past" ? "Elmúlt átvételi dátumú rendelés nem állítható vissza." : undefined}
                className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 transition hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isRestored ? "Visszaállítva" : isRestoring ? "Visszaállítás..." : "Visszaállítás"}
            </button>
            {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
    );
}
