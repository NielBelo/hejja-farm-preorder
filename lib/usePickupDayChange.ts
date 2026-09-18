"use client";

import { useState } from "react";

export type PickupDay = {
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

// A rendelés szerkesztésekor megjelenő "Átvételi nap módosítása" kártya
// közös állapot- és logikakezelése. Az Előzmények oldalon bevezetett
// viselkedést használja fel az admin rendelésszerkesztés is.
export function usePickupDayChange({
    pickupDayId,
    pickupDays,
    originalQuantity,
    requiredQuantity,
}: {
    pickupDayId: number;
    pickupDays: PickupDay[];
    originalQuantity: number;
    requiredQuantity: number;
}) {
    const [selectedPickupDayId, setSelectedPickupDayId] = useState(pickupDayId);
    const [pickupDayCardOpen, setPickupDayCardOpen] = useState(false);
    const [collapseAllSignal, setCollapseAllSignal] = useState(0);
    const [insufficientStockDay, setInsufficientStockDay] =
        useState<PickupDay | null>(null);

    // A jelenleg foglalt napnál a rendelés saját mennyiségét vissza kell adni
    // a készlethez, enélkül a saját napja tűnne tévesen betelt(ebb)nek.
    const pickupDaysForPicker = pickupDays.map((day) =>
        day.id === pickupDayId
            ? { ...day, available_stock: day.available_stock + originalQuantity }
            : day
    );

    const pickupDayForDisplay = pickupDaysForPicker.find(
        (day) => day.id === selectedPickupDayId
    );

    const handleTogglePickupDayCard = () => {
        if (!pickupDayCardOpen) {
            setCollapseAllSignal((n) => n + 1);
        }

        setPickupDayCardOpen((open) => !open);
    };

    const closePickupDayCard = () => setPickupDayCardOpen(false);

    const handleSelectPickupDay = (day: PickupDay) => {
        if (day.id === selectedPickupDayId) return;

        if (requiredQuantity > day.available_stock) {
            setInsufficientStockDay(day);
            return;
        }

        setSelectedPickupDayId(day.id);
    };

    const dismissInsufficientStock = () => setInsufficientStockDay(null);

    const reset = () => {
        setSelectedPickupDayId(pickupDayId);
        setPickupDayCardOpen(false);
        setInsufficientStockDay(null);
    };

    return {
        selectedPickupDayId,
        pickupDayCardOpen,
        collapseAllSignal,
        insufficientStockDay,
        pickupDaysForPicker,
        pickupDayForDisplay,
        pickupDayChanged: selectedPickupDayId !== pickupDayId,
        handleTogglePickupDayCard,
        handleSelectPickupDay,
        closePickupDayCard,
        dismissInsufficientStock,
        reset,
    };
}
