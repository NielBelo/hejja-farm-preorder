"use client";

import { useState } from "react";
import CountdownCard from "@/components/CountdownCard";
import PickupDaySelector from "@/components/PickupDaySelector";
import ProductSelector from "@/components/ProductSelector";

type Product = {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
};

type PackageOption = {
    id: number;
    name: string;
    description: string | null;
};

type PickupDay = {
    id: number;
    year: number;
    season: number;
    serial_number: number;
    pickup_date: string;
    planned_stock: number;
    available_stock: number;
    _group: number;
    is_active: boolean;
};

export default function PreorderManager({
    season,
    products,
    packages,
    pickupDays,
}: {
    season: any;
    products: Product[];
    packages: PackageOption[];
    pickupDays: PickupDay[];
}) {
    const [selectedPickupDay, setSelectedPickupDay] = useState<PickupDay | null>(
        null
    );

    const handlePickupDayChange = (day: PickupDay) => {
        if (
            selectedPickupDay &&
            selectedPickupDay.id !== day.id &&
    hasOrderChanges
        ) {
            setPendingPickupDay(day);
            setShowDayChangeModal(true);
            return;
        }

        setSelectedPickupDay(day);
    };

    const confirmPickupDayChange = () => {
        if (!pendingPickupDay) return;

        setSelectedPickupDay(pendingPickupDay);
        setResetKey((prev) => prev + 1);

        setPendingPickupDay(null);
        setShowDayChangeModal(false);
    };

    const cancelPickupDayChange = () => {
        setPendingPickupDay(null);
        setShowDayChangeModal(false);
    };

    const [resetKey, setResetKey] = useState(0);

    const [pendingPickupDay, setPendingPickupDay] =
        useState<PickupDay | null>(null);

    const [showDayChangeModal, setShowDayChangeModal] =
        useState(false);

    const [hasOrderChanges, setHasOrderChanges] =
  useState(false);

    console.log("selectedPickupDay:", selectedPickupDay);
    console.log(
        "selectedPickupDay available_stock:",
        selectedPickupDay?.available_stock
    );

    return (
        <>
            <CountdownCard
                startDate={season?.time_window_start}
                endDate={season?.time_window_end}
            />

            <PickupDaySelector
                pickupDays={pickupDays}
                selectedPickupDayId={selectedPickupDay?.id ?? null}
                onSelectPickupDay={handlePickupDayChange}
            />

            <ProductSelector
                products={products}
                packages={packages}
                maxAvailableQuantity={selectedPickupDay?.available_stock ?? null}
                resetKey={resetKey}
                isPickupDaySelected={selectedPickupDay !== null}
                onOrderChangesChange={setHasOrderChanges}
            />

            {showDayChangeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">

                        <h2 className="text-lg font-semibold text-gray-800">
                        Figyelem!
                        </h2>

                        <p className="mt-3 text-sm leading-6 text-gray-600">
                            Az átvételi nap módosításával a korábban megadott, de még nem véglegesített rendelési tételek
                            elvesznek. Folytatja?
                        </p>

                        <div className="mt-6 flex justify-end gap-3">

                            <button
                                type="button"
                                onClick={cancelPickupDayChange}
                                className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={confirmPickupDayChange}
                                className="rounded-lg bg-[rgb(49,171,2)] px-4 py-2 font-semibold text-white hover:brightness-95"
                            >
                                Folytatás
                            </button>

                        </div>

                    </div>
                </div>
            )}
        </>
    );
}