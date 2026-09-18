"use client";

import {
    ChevronDownIcon,
    ChevronRightIcon,
} from "@heroicons/react/24/outline";
import PickupDaySelector from "@/components/PickupDaySelector";
import type { PickupDay } from "@/lib/usePickupDayChange";

function getStockStatus(availableStock: number) {
    if (availableStock <= 0) {
        return {
            text: "Előrendelés betelt!",
            iconClass: "text-red-500",
        };
    }

    if (availableStock <= 30) {
        return {
            text: `Már csak ${availableStock} db csirke elérhető!`,
            iconClass: "text-yellow-500",
        };
    }

    return {
        text: "Még több, mint 30 db csirke elérhető!",
        iconClass: "text-[rgb(49,171,2)]",
    };
}

// Az "Átvételi nap módosítása" összecsukható kártya és a hozzá tartozó
// figyelmeztető modál. Az Előzmények oldal és az admin rendelésszerkesztés
// is ugyanezt a megjelenést és viselkedést használja.
export default function PickupDayChangeCard({
    isOpen,
    onToggle,
    pickupDaysForPicker,
    selectedPickupDayId,
    pickupDayForDisplay,
    onSelectPickupDay,
    seasonStartDate,
    seasonEndDate,
    bypassWindow = false,
    insufficientStockDay,
    onDismissInsufficientStock,
}: {
    isOpen: boolean;
    onToggle: () => void;
    pickupDaysForPicker: PickupDay[];
    selectedPickupDayId: number;
    pickupDayForDisplay?: PickupDay;
    onSelectPickupDay: (day: PickupDay) => void;
    seasonStartDate?: string | null;
    seasonEndDate?: string | null;
    bypassWindow?: boolean;
    insufficientStockDay: PickupDay | null;
    onDismissInsufficientStock: () => void;
}) {
    const stockStatus = getStockStatus(
        pickupDayForDisplay?.available_stock ?? 0
    );

    return (
        <>
            {insufficientStockDay && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl">

                        <h2 className="text-2xl font-semibold text-gray-800">
                            Figyelem!
                        </h2>

                        <p className="mt-4 text-lg leading-7 text-gray-600">
                            A kiválasztott napon nincs elegendő készlet a rendelés
                            jelenlegi mennyiségéhez, ezért a rendelés nem
                            helyezhető át erre a napra.
                        </p>

                        <div className="mt-8 flex justify-end">
                            <button
                                type="button"
                                onClick={onDismissInsufficientStock}
                                className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>
                        </div>

                    </div>
                </div>
            )}

            {/* Átvételi nap módosítása - önálló rendelési beállítás, nem tétel */}
            <div className="mb-4 overflow-hidden rounded-xl border border-[rgb(92,113,190)] bg-white">
                <div
                    role="button"
                    tabIndex={0}
                    onClick={onToggle}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onToggle();
                        }
                    }}
                    className={`
        relative flex cursor-pointer items-center justify-center gap-2 px-10 py-3
        ${isOpen ? "border-b border-[rgba(92,113,190,0.25)]" : ""}
        text-gray-700 transition hover:bg-[rgba(92,113,190,0.06)]
    `}
                >
                    <div className="text-center">
                        <span className="block text-lg font-semibold">
                            Átvételi nap módosítása
                        </span>

                        {pickupDayForDisplay && (
                            <span className="mt-1 inline-block rounded-md bg-blue-100 px-2.5 py-1 text-base font-normal text-gray-600">
                                Jelenlegi választás:{" "}
                                <span className="font-semibold">
                                    {new Intl.DateTimeFormat("hu-HU", {
                                        month: "long",
                                        day: "numeric",
                                    }).format(new Date(pickupDayForDisplay.pickup_date))}
                                </span>
                                {" "}– {stockStatus.text}
                            </span>
                        )}
                    </div>

                    <span className="absolute right-4">
                        {isOpen ? (
                            <ChevronDownIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        ) : (
                            <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        )}
                    </span>
                </div>

                {isOpen && (
                    <div className="bg-white p-4">
                        <PickupDaySelector
                            startDate={seasonStartDate}
                            endDate={seasonEndDate}
                            pickupDays={pickupDaysForPicker}
                            selectedPickupDayId={selectedPickupDayId}
                            onSelectPickupDay={onSelectPickupDay}
                            bypassWindow={bypassWindow}
                        />
                    </div>
                )}
            </div>
        </>
    );
}
