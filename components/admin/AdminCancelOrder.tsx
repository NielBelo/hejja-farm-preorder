"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getPickupDateStatus, usePickupDateStatus } from "@/lib/usePickupDateStatus";

export default function AdminCancelOrder({
    orderId,
    publicOrderNumber,
    pickupDate,
    disabled,
    onOpen,
}: {
    orderId: number;
    publicOrderNumber: string;
    pickupDate: string;
    disabled: boolean;
    onOpen: () => void;
}) {
    const router = useRouter();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const requestInFlight = useRef(false);
    const [isCancelling, setIsCancelling] = useState(false);
    const [isCancelled, setIsCancelled] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pickupStatus = usePickupDateStatus(pickupDate);
    const cannotCancel = disabled || isCancelling || isCancelled || pickupStatus !== "current";

    const handleCancelOrder = async () => {
        if (disabled || requestInFlight.current || isCancelled) return;
        if (getPickupDateStatus(pickupDate) !== "current") {
            setError("Teljesített vagy érvényes átvételi dátum nélküli rendelés nem törölhető.");
            return;
        }

        requestInFlight.current = true;
        setIsCancelling(true);
        setError(null);

        try {
            // Use the same soft-cancellation operation as the History page.
            const { error: cancelError } = await createClient().rpc("cancel_order", {
                p_order_id: orderId,
            });

            if (cancelError) {
                setError(cancelError.message || "A rendelés lemondása sikertelen.");
                return;
            }

            setIsCancelled(true);
            dialogRef.current?.close();
            router.refresh();
        } catch {
            setError("A rendelés lemondása sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
        } finally {
            requestInFlight.current = false;
            setIsCancelling(false);
        }
    };

    return (
        <div className="ml-auto">
            <button
                type="button"
                disabled={cannotCancel}
                title={pickupStatus === "past" ? "Teljesített rendelés nem törölhető." : undefined}
                onClick={() => {
                    if (cannotCancel || getPickupDateStatus(pickupDate) !== "current") return;
                    setError(null);
                    onOpen();
                    dialogRef.current?.showModal();
                }}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isCancelled ? "Lemondva" : isCancelling ? "Törlés..." : "Törlés"}
            </button>

            <dialog
                ref={dialogRef}
                aria-labelledby={`cancel-order-title-${orderId}`}
                aria-describedby={`cancel-order-description-${orderId}`}
                aria-busy={isCancelling}
                onCancel={(event) => {
                    if (requestInFlight.current) event.preventDefault();
                }}
                className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl bg-white p-6 shadow-xl backdrop:bg-black/40"
            >
                <h2 id={`cancel-order-title-${orderId}`} className="text-lg font-semibold text-gray-800">
                    Figyelem!
                </h2>
                <p id={`cancel-order-description-${orderId}`} className="mt-3 text-sm leading-6 text-gray-600">
                    Biztosan törölni szeretné a(z){" "}
                    <span className="font-semibold text-gray-800">{publicOrderNumber}</span>{" "}
                    azonosítójú rendelést? A rendelés lemondott állapotba kerül, az adatai megmaradnak.
                </p>

                {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        disabled={isCancelling}
                        onClick={() => dialogRef.current?.close()}
                        className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Mégse
                    </button>
                    <button
                        type="button"
                        onClick={handleCancelOrder}
                        disabled={cannotCancel}
                        className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isCancelling ? "Törlés..." : "Törlés"}
                    </button>
                </div>
            </dialog>
        </div>
    );
}
