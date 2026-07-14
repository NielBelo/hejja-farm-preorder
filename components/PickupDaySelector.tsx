"use client";

import { ArchiveBoxIcon } from "@heroicons/react/24/outline";

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
}: {
    pickupDays: PickupDay[];
    selectedPickupDayId: number | null;
    onSelectPickupDay: (day: PickupDay) => void;
}) {
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

    const formatDate = (date: string) =>
        new Intl.DateTimeFormat("hu-HU", {
            month: "long",
            day: "numeric",
        }).format(new Date(date));

    const formatWeekday = (date: string) =>
        new Intl.DateTimeFormat("hu-HU", {
            weekday: "long",
        }).format(new Date(date));

    return (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-center text-base font-semibold text-gray-700">
                Válasszon átvételi napot!
            </h2>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {pickupDays.map((day) => {
                    const selected = selectedPickupDayId === day.id;
                    const status = getStatus(day.available_stock);
                    const isFull = day.available_stock <= 0;

                    return (
                        <button
                            key={day.id}
                            disabled={isFull}
                            type="button"
                            onClick={() => onSelectPickupDay(day)}
                            className={`
                                relative h-[160px] rounded-xl p-4 text-left transition-all
                                ${
                                    selected
                                        ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                        : "border-2 border-[rgba(7,109,143,0.2)] hover:scale-103 hover:bg-gray-50"
                                }
                                ${isFull ? "cursor-not-allowed" : ""}
                            `}
                        >
                            <div className="h-[76px] pr-12">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    {day.serial_number}. nap
                                </p>

                                <p className="mt-1 text-base font-bold text-gray-700">
                                    {formatDate(day.pickup_date)}
                                </p>

                                <p className="text-sm capitalize text-gray-500">
                                    {formatWeekday(day.pickup_date)}
                                </p>
                            </div>

                            <ArchiveBoxIcon
                                className={`absolute right-4 top-4 h-8 w-8 ${status.iconClass}`}
                            />

                            <p className="h-[44px] text-sm font-medium leading-5 text-gray-700">
                                {status.text}
                            </p>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}