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
            !window.confirm(
                "Az átvételi nap módosításával a korábban megadott rendelési tételek elvesznek. Folytatja?"
            )
        ) {
            return;
        }

        if (
            selectedPickupDay &&
            selectedPickupDay.id !== day.id
        ) {
            setResetKey((prev) => prev + 1);
        }

        setSelectedPickupDay(day);
    };

    const [resetKey, setResetKey] = useState(0);

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
            />
        </>
    );
}