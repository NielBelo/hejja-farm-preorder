"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDaysIcon, CheckIcon, ChevronDownIcon, PrinterIcon } from "@heroicons/react/24/outline";
import {
    formatPhoneNumber,
    getInitialPickupDate,
    getPickupDistributions,
    summarizePackage,
    summarizePickupOrders,
    summarizeSize,
    type PickupDistributionEntry,
    type PickupSheetOrder,
} from "@/lib/pickupSheet";
import { useCurrentBudapestDate } from "@/lib/usePickupDateStatus";

const distributionColors = ["#64748b", "#cbd5e1", "#94a3b8", "#e5e7eb", "#78716c", "#d6d3d1"];

const percentageFormatter = new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: 1,
});

function PickupDateDropdown({
    dates,
    value,
    disabled,
    onChange,
}: {
    dates: { value: string; label: string }[];
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const expanded = open && !disabled;
    const selectedLabel = dates.find((date) => date.value === value)?.label ?? "Nincs választható nap";

    useEffect(() => {
        if (!expanded) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, [expanded]);

    return (
        <div
            ref={root}
            className="relative min-w-0 flex-1 sm:max-w-xs"
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
            onKeyDown={(event) => {
                if (event.key === "Escape" && expanded) {
                    event.preventDefault();
                    setOpen(false);
                    trigger.current?.focus();
                }
            }}
        >
            <button
                ref={trigger}
                type="button"
                disabled={disabled}
                aria-label={`Átvételi nap: ${selectedLabel}`}
                aria-haspopup="listbox"
                aria-expanded={expanded}
                aria-controls={`${id}-options`}
                onClick={() => setOpen((current) => !current)}
                className="flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300"
            >
                <CalendarDaysIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-500" />
                <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{selectedLabel}</span>
                <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>

            {expanded && (
                <div
                    id={`${id}-options`}
                    role="listbox"
                    aria-label="Átvételi nap"
                    className="absolute top-full right-0 left-0 z-40 mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-300 bg-white p-1.5"
                >
                    {dates.map((date) => {
                        const selected = date.value === value;
                        return (
                            <button
                                key={date.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                    onChange(date.value);
                                    setOpen(false);
                                    trigger.current?.focus();
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition ${selected
                                    ? "bg-gray-200 font-semibold text-gray-900"
                                    : "text-gray-700 hover:bg-gray-100"
                                }`}
                            >
                                <span>{date.label}</span>
                                <CheckIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${selected ? "text-gray-700" : "invisible"}`} />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function DistributionChart({
    title,
    entries,
}: {
    title: string;
    entries: PickupDistributionEntry[];
}) {
    return (
        <section className="h-full rounded-lg border border-gray-300 bg-white px-3 py-3 shadow-sm">
            <h2 className="text-center text-xs font-semibold text-gray-700">{title}</h2>
            {entries.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">Nincs adat</p>
            ) : (
                <div className="mt-3">
                    <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-200" aria-label={`${title}, 100 százalékos halmozott diagram`}>
                        {entries.map((entry, index) => (
                            <div
                                key={entry.label}
                                className="h-full border-r border-white last:border-r-0"
                                title={`${entry.label}: ${entry.quantity} db, ${percentageFormatter.format(entry.percentage)}%`}
                                style={{
                                    flexBasis: 0,
                                    flexGrow: entry.quantity,
                                    backgroundColor: distributionColors[index % distributionColors.length],
                                }}
                            />
                        ))}
                    </div>

                    <div className="mt-3 space-y-1.5">
                    {entries.map((entry, index) => (
                        <div key={entry.label} className="flex items-center justify-between gap-2 text-[11px] leading-tight text-gray-600">
                            <span className="flex min-w-0 items-center gap-1.5 font-medium">
                                <span
                                    aria-hidden="true"
                                    className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-gray-300"
                                    style={{ backgroundColor: distributionColors[index % distributionColors.length] }}
                                />
                                <span className="min-w-0 break-words">{entry.label}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-gray-500">
                                {entry.quantity} db · {percentageFormatter.format(entry.percentage)}%
                            </span>
                        </div>
                    ))}
                    </div>
                </div>
            )}
        </section>
    );
}

export default function PickupSheet({
    orders,
    pickupDates,
}: {
    orders: PickupSheetOrder[];
    pickupDates: { value: string; label: string }[];
}) {
    const today = useCurrentBudapestDate();
    const [selectedDate, setSelectedDate] = useState("");
    const activeDate = selectedDate || getInitialPickupDate(
        pickupDates.map((date) => date.value),
        today
    );
    const activeDateLabel = pickupDates.find((date) => date.value === activeDate)?.label ?? "";
    const visibleOrders = useMemo(
        () => orders.filter((order) => order.pickupDate === activeDate),
        [orders, activeDate]
    );
    const summary = useMemo(() => summarizePickupOrders(visibleOrders), [visibleOrders]);
    const distributions = useMemo(() => getPickupDistributions(visibleOrders), [visibleOrders]);
    const printSummaryLabel = `${summary.chickenCount} csirke · ${summary.itemCount} tétel · ${summary.customerCount} vevő`;

    useEffect(() => {
        const root = document.documentElement;
        const previousDate = root.style.getPropertyValue("--pickup-print-date");
        const previousSummary = root.style.getPropertyValue("--pickup-print-summary");

        root.style.setProperty("--pickup-print-date", JSON.stringify(activeDateLabel));
        root.style.setProperty("--pickup-print-summary", JSON.stringify(printSummaryLabel));

        return () => {
            if (previousDate) root.style.setProperty("--pickup-print-date", previousDate);
            else root.style.removeProperty("--pickup-print-date");

            if (previousSummary) root.style.setProperty("--pickup-print-summary", previousSummary);
            else root.style.removeProperty("--pickup-print-summary");
        };
    }, [activeDateLabel, printSummaryLabel]);

    return (
        <div className="pickup-print-page">
            <div className="print-hidden mb-3">
                <div className="flex items-end justify-between gap-4 border-b-2 border-gray-600 pb-3">
                    <PickupDateDropdown
                        dates={pickupDates}
                        value={activeDate}
                        disabled={pickupDates.length === 0}
                        onChange={setSelectedDate}
                    />

                    <button
                        type="button"
                        disabled={visibleOrders.length === 0}
                        onClick={() => window.print()}
                        className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300"
                    >
                        <PrinterIcon aria-hidden="true" className="h-5 w-5" />
                        Nyomtatás / Mentés PDF-ként
                    </button>
                </div>

                <div className="mt-3 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <section aria-live="polite" className="h-full rounded-lg border border-gray-300 bg-white px-3 py-3 shadow-sm">
                        <h2 className="text-center text-xs font-semibold text-gray-700">Napi összesítés</h2>
                        <div className="mt-3 grid grid-cols-3 divide-x divide-gray-300 text-center text-gray-600">
                            <div className="px-1">
                                <strong className="block text-lg font-semibold tabular-nums text-gray-800">{summary.chickenCount}</strong>
                                <span className="text-[11px]">csirke</span>
                            </div>
                            <div className="px-1">
                                <strong className="block text-lg font-semibold tabular-nums text-gray-800">{summary.itemCount}</strong>
                                <span className="text-[11px]">tétel</span>
                            </div>
                            <div className="px-1">
                                <strong className="block text-lg font-semibold tabular-nums text-gray-800">{summary.customerCount}</strong>
                                <span className="text-[11px]">vevő</span>
                            </div>
                        </div>
                    </section>

                    <DistributionChart title="Terméktípusok eloszlása" entries={distributions.products} />
                    <DistributionChart title="Csomagolástípusok eloszlása" entries={distributions.packages} />
                    <DistributionChart title="Méret eloszlása" entries={distributions.sizes} />
                </div>

                <div className="mx-auto mt-6 flex w-full max-w-4xl items-center gap-4">
                    <div className="h-px flex-1 bg-gray-400" />
                    <h2 className="text-md font-semibold tracking-wider text-gray-500">
                        NYOMTATÁSI ELŐNÉZET
                    </h2>
                    <div className="h-px flex-1 bg-gray-400" />
                </div>
            </div>

            {visibleOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-12 text-center text-sm text-gray-500">
                    Nincs aktív rendelés a kiválasztott átvételi napra.
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-black bg-white shadow-sm print:rounded-none print:shadow-none">
                    <table className="w-full table-fixed border-collapse text-center text-[clamp(9px,1.4vw,15px)] leading-snug text-gray-800 print:text-[11pt] [&_td]:align-middle [&_th]:align-middle">
                        <colgroup>
                            <col className="w-[22.5%]" />
                            <col className="w-[6%]" />
                            <col className="w-[10%]" />
                            <col className="w-[10%]" />
                            <col className="w-[10%]" />
                            <col className="w-[10%]" />
                            <col className="w-[22.5%]" />
                            <col className="w-[9%]" />
                        </colgroup>
                        <thead className="bg-gray-300 font-semibold text-gray-800 print:table-header-group">
                            <tr>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-2 py-2">Rendelési adatok</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2 text-center">Tétel</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2">Termék</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2 text-center">Menny.</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2">Csom.</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2">Méret</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-2">Megjegyzés</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1 py-2 text-center">Státusz</th>
                            </tr>
                        </thead>
                        {visibleOrders.map((order, orderIndex) => {
                            const rows = order.items.length > 0 ? order.items : [null];
                            const rowBackground = orderIndex % 2 === 0 ? "bg-white" : "bg-gray-200";
                            return (
                                <tbody key={order.id} className="break-inside-avoid">
                                    {rows.map((item, itemIndex) => (
                                        <tr key={item?.id ?? `${order.id}-empty`} className={rowBackground}>
                                                {itemIndex === 0 && (
                                                    <td rowSpan={rows.length} className="break-words border border-black px-2 py-2 text-left text-gray-900">
                                                        <div className="space-y-1">
                                                            <p className="flex flex-wrap items-center gap-1.5">
                                                                <span className="inline-flex min-w-6 items-center justify-center rounded bg-gray-700 px-1.5 font-semibold leading-tight text-white">{orderIndex + 1}.</span>
                                                                <span>{order.public_order_number}</span>
                                                            </p>
                                                            <p><span className="font-semibold">Név:</span> {order.customerName}</p>
                                                            <p><span className="font-semibold">Tel.:</span> <span className="whitespace-nowrap">{formatPhoneNumber(order.phone)}</span></p>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="border border-black px-1.5 py-1.5 text-center">{itemIndex + 1}.</td>
                                                <td className="break-words border border-black px-1.5 py-1.5 font-medium">{item?.products?.name ?? "—"}</td>
                                                <td className="border border-black px-1.5 py-1.5 text-center font-semibold">{item ? `${item.quantity} db` : "—"}</td>
                                                <td className="break-words border border-black px-1.5 py-1.5">{summarizePackage(item?.packages?.name)}</td>
                                                <td className="break-words border border-black px-1.5 py-1.5">{summarizeSize(item?.size_preference)}</td>
                                                <td className="max-w-52 break-words border border-black px-1.5 py-1.5">{item?.note || "—"}</td>
                                                <td className="border border-black px-1 py-1.5 text-center align-middle">
                                                    <span aria-label="Teljesítési státusz jelölőnégyzet" className="inline-block h-4 w-4 rounded-[2px] border border-black bg-white print:h-3.5 print:w-3.5" />
                                                </td>
                                        </tr>
                                    ))}
                                </tbody>
                            );
                        })}
                    </table>
                </div>
            )}
        </div>
    );
}
