"use client";

import { ArchiveBoxIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { isWithinOrderWindow, useOrderWindow } from "@/lib/useOrderWindow";

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

export default function PickupDaySelector({
    pickupDays,
    selectedPickupDayId,
    onSelectPickupDay,
    startDate,
    endDate,
}: {
    pickupDays: PickupDay[];
    selectedPickupDayId: number | null;
    onSelectPickupDay: (day: PickupDay) => void;
    startDate?: string | null;
    endDate?: string | null;
}) {
    const isOrderingOpen = useOrderWindow(startDate, endDate);
    const displayedPickupDays = [...pickupDays]
        .sort(
            (first, second) =>
                new Date(first.pickup_date).getTime() -
                new Date(second.pickup_date).getTime()
        )
        .slice(0, 5);

    const getStatus = (availableStock: number) => {
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
    };

    const formatMonth = (date: string) =>
        new Intl.DateTimeFormat("hu-HU", {
            month: "long",
        }).format(new Date(date));

    const formatDay = (date: string) =>
        new Intl.DateTimeFormat("hu-HU", {
            day: "numeric",
        }).format(new Date(date));

    const formatWeekday = (date: string) =>
        new Intl.DateTimeFormat("hu-HU", {
            weekday: "long",
        }).format(new Date(date));

    return (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-center text-xl font-semibold text-gray-700">
                {isOrderingOpen
                    ? "Válasszon átvételi napot!"
                    : "Jelenleg nincs lehetőség előrendelésre!"}
            </h2>
            {!isOrderingOpen && (
                <p className="text-center text-xl font-semibold text-gray-700">
                    A következő előrendelési lehetőségről e-mailben értesítjük.
                </p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
                {!isOrderingOpen ? [1, 2, 3, 4, 5].map((number) => (
                    <button
                        key={number}
                        type="button"
                        disabled
                        aria-label={`${number}. nap – jelenleg nem elérhető`}
                        className="relative flex h-[168px] cursor-not-allowed flex-col items-stretch justify-start rounded-xl border-2 border-gray-300 bg-gray-100 p-3 text-left"
                    >
                        <div className="pr-10">
                            <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                {number}. nap
                            </p>
                        </div>
                        <NoSymbolIcon
                            aria-hidden="true"
                            className="absolute right-3 top-3 h-8 w-8 text-gray-400"
                        />
                        <div className="mx-auto mt-2 w-4/5 border-t-2 border-black" aria-hidden="true" />
                    </button>
                )) : displayedPickupDays.map((day) => {
                    const selected = selectedPickupDayId === day.id;
                    const status = getStatus(day.available_stock);
                    const isFull = day.available_stock <= 0;
                    const cardBorderClass = selected
                        ? "border-[rgb(49,171,2)]"
                        : "border-[rgba(7,109,143,0.2)]";

                    return (
                        <button
                            key={day.id}
                            disabled={isFull}
                            type="button"
                            onClick={() => {
                                if (isWithinOrderWindow(startDate, endDate)) {
                                    onSelectPickupDay(day);
                                }
                            }}
                            className={`
                                relative flex h-[168px] flex-col items-stretch justify-start rounded-xl p-3 text-left transition-all
                                ${
                                    selected
                                        ? `border-2 ${cardBorderClass} bg-[rgba(216,227,232,0.51)] shadow-md`
                                        : `border-2 ${cardBorderClass} hover:scale-103 hover:bg-gray-50`
                                }
                                ${isFull ? "cursor-not-allowed" : ""}
                            `}
                        >
                            <div className="pr-10">
                                <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                    {day.serial_number}. nap
                                </p>

                                <p className="mt-1 text-xl font-bold leading-7 text-gray-700">
                                    <span className="block whitespace-nowrap">
                                        {formatMonth(day.pickup_date)}
                                    </span>
                                </p>

                                <p className="text-base font-semibold capitalize text-gray-600">
                                    {formatDay(day.pickup_date)}. – {formatWeekday(day.pickup_date)}
                                </p>
                            </div>

                            <ArchiveBoxIcon
                                className={`absolute right-3 top-3 h-8 w-8 ${status.iconClass}`}
                            />

                            <div className="mx-auto mt-2 w-4/5 border-t-2 border-black" />

                            <p className={`mt-2 text-center text-base font-medium leading-5 ${status.iconClass}`}>
                                {status.text}
                            </p>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
