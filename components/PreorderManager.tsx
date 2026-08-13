"use client";

import { useState } from "react";
import CountdownCard from "@/components/CountdownCard";
import PickupDaySelector from "@/components/PickupDaySelector";
import ProductSelector from "@/components/ProductSelector";
import { createClient } from "@/lib/supabase/client";

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

type OrderItem = {
    selectedProductId: number | null;
    selectedPackageId: number | null;
    quantity: number;
    note: string;
    selectedNote: string;
    collapsed: boolean;
    touched: boolean;
    showValidation: boolean;
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

    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

    const validOrderItems = orderItems.filter(
        (item) =>
            item.selectedProductId !== null ||
            item.selectedPackageId !== null
    );

    const canSubmitOrder =
        selectedPickupDay !== null &&
        validOrderItems.length > 0 &&
        validOrderItems.every(
            (item) =>
                item.selectedProductId !== null &&
                item.selectedPackageId !== null &&
                item.collapsed
        );

    const handleFinalizeOrder = async () => {
        if (!canSubmitOrder || !selectedPickupDay) {
            return;
        }

        const rpcItems = validOrderItems.map((item) => ({
            product_id: item.selectedProductId,
            package_id: item.selectedPackageId,
            quantity: item.quantity,
            size_preference: item.selectedNote,
            note: item.note || null,
        }));

        console.log("RPC items:", rpcItems);
        console.log("Selected pickup day:", selectedPickupDay);

        const supabase = createClient();

        const { data, error } = await supabase.rpc("finalize_order", {
            p_season_parameter_id: season.id,
            p_pickup_day_id: selectedPickupDay.id,
            p_items: rpcItems,
        });

        console.log("RPC data:", data);
        console.log("RPC error:", error);
    };

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
                onItemsChange={setOrderItems}
            />



            <div className="mt-10 border-t border-gray-300 pt-8">

                {validOrderItems.length > 0 &&
                    validOrderItems.some((item) => !item.collapsed) && (
                        <p className="mb-4 text-center text-sm font-medium text-gray-600">
                            A rendelés véglegesítéséhez először fejezze be az összes tételt!
                        </p>
                    )}

                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={handleFinalizeOrder}
                        disabled={!canSubmitOrder}
                        className={`
                rounded-lg px-8 py-3 font-semibold text-white transition
                ${canSubmitOrder
                                ? "bg-[rgb(49,171,2)] hover:brightness-95"
                                : "cursor-not-allowed bg-gray-300"
                            }
            `}
                    >
                        Rendelés véglegesítése
                    </button>
                </div>
            </div>

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