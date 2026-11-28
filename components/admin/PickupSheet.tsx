"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDaysIcon, CheckIcon, ChevronDownIcon, PrinterIcon } from "@heroicons/react/24/outline";
import {
    formatPhoneNumber,
    formatPrintHeaderDate,
    getInitialPickupDate,
    getPickupDistributions,
    summarizePickupOrders,
    summarizePickupStock,
    summarizePrintPackage,
    summarizeProduct,
    summarizeSize,
    type PickupDateOption,
    type PickupDistributionEntry,
    type PickupSheetOrder,
} from "@/lib/pickupSheet";
import { useCurrentBudapestDate } from "@/lib/usePickupDateStatus";

const distributionColors = ["#43852D", "#D4CCBE", "#8A7355", "#B7D3A0", "#B8A68A", "#E8DFD0"];

const percentageFormatter = new Intl.NumberFormat("hu-HU", {
    maximumFractionDigits: 1,
});

const PRINT_PRODUCT_ROWS = [{ label: "Egész" }, { label: "Darab" }, { label: "Extra" }];
const PRINT_SIZE_COLUMNS = [
    { label: "Kisebb", title: "Kicsi" },
    { label: "Átlagos", title: "Átlagos" },
    { label: "Nagyobb", title: "Nagy" },
];

type SelectOption ={ value: string; label: string };

// Közös lenyíló választó a szezon- és az átvételinap-választóhoz (lásd
// PickupSheet lent) - ugyanaz a megjelenés/viselkedés, csak a felkínált
// opciók és a feliratok különböznek.
function SelectDropdown({
    ariaLabel,
    emptyLabel,
    options,
    value,
    disabled,
    onChange,
}: {
    ariaLabel: string;
    emptyLabel: string;
    options: SelectOption[];
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const expanded = open && !disabled;
    const selectedLabel = options.find((option) => option.value === value)?.label ?? emptyLabel;

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
                aria-label={`${ariaLabel}: ${selectedLabel}`}
                aria-haspopup="listbox"
                aria-expanded={expanded}
                aria-controls={`${id}-options`}
                onClick={() => setOpen((current) => !current)}
                className="flex w-full items-center gap-2 rounded-lg border border-[#D4CCBE] bg-[#F4F1EA] px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-[#F0F5EB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#43852D] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300"
            >
                <CalendarDaysIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-gray-500" />
                <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{selectedLabel}</span>
                <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>

            {expanded && (
                <div
                    id={`${id}-options`}
                    role="listbox"
                    aria-label={ariaLabel}
                    className="absolute top-full right-0 left-0 z-40 mt-2 max-h-64 overflow-y-auto rounded-lg border border-[#D4CCBE] bg-white p-1.5"
                >
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                    trigger.current?.focus();
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition ${selected
                                    ? "bg-[#E0EED4] font-semibold text-gray-900"
                                    : "text-gray-700 hover:bg-[#F0F5EB]"
                                }`}
                            >
                                <span>{option.label}</span>
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
        <section className="h-full rounded-lg border border-[#D4CCBE] bg-white px-4 py-4 shadow-sm">
            <h2 className="text-center text-sm font-semibold text-gray-700">{title}</h2>
            {entries.length === 0 ? (
                <p className="py-4 text-center text-sm text-gray-400">Nincs adat</p>
            ) : (
                <div className="mt-3">
                    <div className="flex h-4 w-full overflow-hidden rounded-full bg-[#E8DFD0]" aria-label={`${title}, 100 százalékos halmozott diagram`}>
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
                        <div key={entry.label} className="flex items-center justify-between gap-2 text-xs leading-tight text-gray-600">
                            <span className="flex min-w-0 items-center gap-1.5 font-medium">
                                <span
                                    aria-hidden="true"
                                    className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-[#D4CCBE]"
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
    seasonOptions,
    initialSeason,
}: {
    orders: PickupSheetOrder[];
    pickupDates: PickupDateOption[];
    seasonOptions: SelectOption[];
    initialSeason: string;
}) {
    const today = useCurrentBudapestDate();
    const [selectedSeason, setSelectedSeason] = useState("");
    const [selectedDate, setSelectedDate] = useState("");
    const activeSeason = selectedSeason || initialSeason;
    // A második (átvételinap-) választó kizárólag a kiválasztott szezon
    // napjait kínálja fel - lásd lib/pickupSheet.ts PickupDateOption.date
    // kommentjét arról, hogy a seasonValue miért szükséges a helyes
    // szűréshez.
    const pickupDatesForSeason = useMemo(
        () => pickupDates.filter((date) => date.seasonValue === activeSeason),
        [pickupDates, activeSeason]
    );
    const activeDate = selectedDate || getInitialPickupDate(pickupDatesForSeason, today);
    const activePickupDate = pickupDatesForSeason.find((date) => date.value === activeDate);
    // A DUNAVECSE nap dátuma megegyezhet egy normál nap dátumával, két
    // különböző szezon pedig (elvben) azonos dátumú napot is tartalmazhat
    // (lásd lib/pickupSheet.ts PickupDateOption.date kommentjét) - ezért a
    // puszta dátum-egyezés önmagában nem elég a szűréshez, a kind-nak és a
    // szezonnak is egyeznie kell.
    const visibleOrders = useMemo(
        () => orders.filter((order) => (
            order.pickupDate === activePickupDate?.date
            && order.pickupKind === (activePickupDate?.kind ?? "normal")
            && order.pickupSeasonValue === activeSeason
        )),
        [orders, activePickupDate, activeSeason]
    );

    // Szezonváltáskor az előzőleg kézzel kiválasztott nap (ha volt) egy
    // másik szezonhoz tartozhat - ilyenkor töröljük, hogy az új szezon
    // saját alapértelmezett napja (getInitialPickupDate) választódjon ki,
    // ne maradjon egy érvénytelen/idegen szezonbeli érték.
    const handleSeasonChange = (season: string) => {
        setSelectedSeason(season);
        setSelectedDate("");
    };
    const summary = useMemo(() => summarizePickupOrders(visibleOrders), [visibleOrders]);
    const stock = summarizePickupStock(
        activePickupDate?.plannedStock ?? 0,
        activePickupDate?.availableStock ?? 0
    );
    const distributions = useMemo(() => getPickupDistributions(visibleOrders), [visibleOrders]);
    const printTitle = `RENDELÉSI NAP ${formatPrintHeaderDate(activePickupDate?.date ?? "")}${activePickupDate?.kind === "dunavecse" ? " – DUNAVECSE" : ""}`;
    // A lapmargó közepén (globals.css @top-center) megjelenő kis dátum.
    const printMarginDate = formatPrintHeaderDate(activePickupDate?.date ?? "");

    useEffect(() => {
        const root = document.documentElement;
        const previousDate = root.style.getPropertyValue("--pickup-print-date");

        root.style.setProperty("--pickup-print-date", JSON.stringify(printMarginDate));

        return () => {
            if (previousDate) root.style.setProperty("--pickup-print-date", previousDate);
            else root.style.removeProperty("--pickup-print-date");
        };
    }, [printMarginDate]);

    // A nyomtatási fejléc kereszttáblája: sorok a termékek, oszlopok a
    // méretek (summarizeProduct / summarizeSize címkék), db-ban.
    const printMatrix = useMemo(() => {
        const rows = PRINT_PRODUCT_ROWS.map(() => PRINT_SIZE_COLUMNS.map(() => 0));
        for (const order of visibleOrders) {
            for (const item of order.items) {
                const row = PRINT_PRODUCT_ROWS.findIndex(({ label }) => label === summarizeProduct(item.products?.name));
                const column = PRINT_SIZE_COLUMNS.findIndex(({ label }) => label === summarizeSize(item.size_preference));
                if (row >= 0 && column >= 0) rows[row][column] += item.quantity;
            }
        }
        return rows;
    }, [visibleOrders]);
    const printColumnTotals = PRINT_SIZE_COLUMNS.map((_, column) => printMatrix.reduce((sum, row) => sum + row[column], 0));

    return (
        <div className="pickup-print-page">
            <div className="print-hidden mb-3">
                <div className="flex flex-col gap-4 border-b-2 border-[#8A7355] pb-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0">
                            <span className="mb-1 block text-xs font-semibold text-gray-500">Szezon</span>
                            <SelectDropdown
                                ariaLabel="Szezon"
                                emptyLabel="Nincs választható szezon"
                                options={seasonOptions}
                                value={activeSeason}
                                disabled={seasonOptions.length === 0}
                                onChange={handleSeasonChange}
                            />
                        </div>

                        <div className="min-w-0">
                            <span className="mb-1 block text-xs font-semibold text-gray-500">Átvételi nap</span>
                            <SelectDropdown
                                ariaLabel="Átvételi nap"
                                emptyLabel="Nincs választható nap"
                                options={pickupDatesForSeason}
                                value={activeDate}
                                disabled={pickupDatesForSeason.length === 0}
                                onChange={setSelectedDate}
                            />
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={visibleOrders.length === 0}
                        onClick={() => window.print()}
                        className="flex shrink-0 items-center gap-2 rounded-lg border border-[#D4CCBE] bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-[#F0F5EB] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300"
                    >
                        <PrinterIcon aria-hidden="true" className="h-5 w-5" />
                        Nyomtatás / Mentés PDF-ként
                    </button>
                </div>

                <div className="mt-3 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <section aria-live="polite" className="h-full rounded-lg border border-[#D4CCBE] bg-white px-4 py-4 shadow-sm">
                        <h2 className="text-center text-sm font-semibold text-gray-700">Napi készlet</h2>
                        {activePickupDate?.kind === "dunavecse" ? (
                            <div className="mt-3">
                                <p className="text-center text-sm text-gray-500">
                                    Korlátlan (DUNAVECSE technikai nap)
                                </p>
                                <div className="mt-3 space-y-1.5 text-xs leading-tight text-gray-600">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 font-medium">
                                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#43852D] ring-1 ring-[#D4CCBE]" />
                                            Lefoglalt
                                        </span>
                                        <span className="tabular-nums text-gray-500">{summary.chickenCount} db</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-3">
                                <div
                                    className="flex h-4 w-full overflow-hidden rounded-full bg-[#E8DFD0]"
                                    aria-label={`Napi készlet: ${stock.usedCount} csirke lefoglalva, ${stock.availableCount} csirke elérhető, napi limit ${stock.capacity} csirke`}
                                    title={`${stock.usedCount} lefoglalt · ${stock.availableCount} elérhető · ${stock.capacity} napi limit`}
                                >
                                    {stock.usedCount > 0 && (
                                        <div
                                            className="h-full border-r border-white bg-[#43852D]"
                                            style={{ width: `${stock.usedPercentage}%` }}
                                        />
                                    )}
                                    {stock.availableCount > 0 && (
                                        <div
                                            className="h-full bg-[#D4CCBE]"
                                            style={{ width: `${stock.availablePercentage}%` }}
                                        />
                                    )}
                                </div>
                                <div className="mt-3 space-y-1.5 text-xs leading-tight text-gray-600">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 font-medium">
                                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#43852D] ring-1 ring-[#D4CCBE]" />
                                            Lefoglalt
                                        </span>
                                        <span className="tabular-nums text-gray-500">{stock.usedCount} db · {percentageFormatter.format(stock.usedPercentage)}%</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="flex items-center gap-1.5 font-medium">
                                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[#D4CCBE] ring-1 ring-[#D4CCBE]" />
                                            Elérhető
                                        </span>
                                        <span className="tabular-nums text-gray-500">{stock.availableCount} db · {percentageFormatter.format(stock.availablePercentage)}%</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 border-t border-[#E8DFD0] pt-1.5">
                                        <span className="font-medium">Napi limit</span>
                                        <span className="tabular-nums text-gray-500">{stock.capacity} db</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    <DistributionChart title="Terméktípusok eloszlása" entries={distributions.products} />
                    <DistributionChart title="Csomagolástípusok eloszlása" entries={distributions.packages} />
                    <DistributionChart title="Méret eloszlása" entries={distributions.sizes} />
                </div>

                <div className="mt-3 grid items-stretch gap-4">
                    <section aria-live="polite" className="h-full rounded-lg border border-[#D4CCBE] bg-white px-4 py-4 shadow-sm">
                        <h2 className="text-center text-sm font-semibold text-gray-700">Napi összesítés</h2>
                        <div className="mt-3 grid grid-cols-3 divide-x divide-[#D4CCBE] text-center text-gray-600">
                            <div className="px-1">
                                <strong className="block text-xl font-semibold tabular-nums text-gray-800">{summary.customerCount}</strong>
                                <span className="text-xs">vevő</span>
                            </div>
                            <div className="px-1">
                                <strong className="block text-xl font-semibold tabular-nums text-gray-800">{summary.orderCount}</strong>
                                <span className="text-xs">rendelés</span>
                            </div>
                            <div className="px-1">
                                <strong className="block text-xl font-semibold tabular-nums text-gray-800">{summary.itemCount}</strong>
                                <span className="text-xs">tétel</span>
                            </div>
                        </div>
                    </section>
                </div>

                <div className="mx-auto mt-6 flex w-full max-w-4xl items-center gap-4">
                    <div className="h-px flex-1 bg-[#D4CCBE]" />
                    <h2 className="text-md font-semibold tracking-wider text-[#8A7355]">
                        NYOMTATÁSI ELŐNÉZET
                    </h2>
                    <div className="h-px flex-1 bg-[#D4CCBE]" />
                </div>
            </div>

            {visibleOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#D4CCBE] bg-white px-5 py-12 text-center text-sm text-gray-500">
                    Nincs aktív rendelés a kiválasztott átvételi napra.
                </div>
            ) : (
                <div className="rounded-xl border border-[#D4CCBE] bg-white p-4 sm:p-6 print:rounded-none print:border-0 print:p-0">
                <div className="bg-white">
                    <table className="w-full table-fixed border-collapse text-center text-[clamp(9px,1.4vw,15px)] leading-none text-gray-800 print:text-[11pt] [&_td]:align-middle [&_th]:align-middle">
                        <colgroup>
                            <col className="w-[22.5%]" />
                            <col className="w-[6%]" />
                            <col className="w-[10%]" />
                            <col className="w-[10%]" />
                            <col className="w-[9%]" />
                            <col className="w-[12%]" />
                            <col className="w-[21.5%]" />
                            <col className="w-[9%]" />
                        </colgroup>
                        <thead className="bg-[#E8DFD0] font-semibold text-[#604D35] print:table-header-group">
                            <tr className="bg-white text-black">
                                <th colSpan={8} className="px-4 pt-5 pb-4 text-center text-[1.9em] leading-tight font-bold">{printTitle}</th>
                            </tr>
                            <tr className="bg-white text-black">
                                <th colSpan={8} className="px-4 pb-5 font-semibold">
                                    <table className="mx-auto w-3/5 border-collapse text-center text-[1.25em] leading-tight">
                                        <thead>
                                            <tr>
                                                <th className="border border-black px-2 py-1.5" />
                                                {PRINT_SIZE_COLUMNS.map((column) => (
                                                    <th key={column.label} className="border border-black px-2 py-1.5">{column.title}</th>
                                                ))}
                                                <th className="border border-black bg-[#E8DFD0] px-2 py-1.5">Összesen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {PRINT_PRODUCT_ROWS.map((product, rowIndex) => (
                                                <tr key={product.label}>
                                                    <th className="border border-black px-2 py-1.5 text-left">{product.label}</th>
                                                    {printMatrix[rowIndex].map((count, column) => (
                                                        <td key={column} className="border border-black px-2 py-1.5 font-normal tabular-nums">{count} db</td>
                                                    ))}
                                                    <td className="border border-black bg-[#E8DFD0] px-2 py-1.5 tabular-nums">{printMatrix[rowIndex].reduce((sum, count) => sum + count, 0)} db</td>
                                                </tr>
                                            ))}
                                            <tr className="bg-[#E8DFD0]">
                                                <th className="border border-black px-2 py-1.5 text-left">Összesen</th>
                                                {printColumnTotals.map((count, column) => (
                                                    <td key={column} className="border border-black px-2 py-1.5 tabular-nums">{count} db</td>
                                                ))}
                                                <td className="border border-black px-2 py-1.5 tabular-nums">{printColumnTotals.reduce((sum, count) => sum + count, 0)} db</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </th>
                            </tr>
                            <tr>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-2 py-0.5">Rendelési adatok</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5 text-center">Tétel</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5">Termék</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5 text-center">Menny.</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5">Csom.</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5">Méret</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1.5 py-0.5">Megjegyzés</th>
                                <th className="overflow-hidden whitespace-nowrap border border-black px-1 py-0.5 text-center print:shadow-[inset_-1px_0_0_#000]">Státusz</th>
                            </tr>
                        </thead>
                        {visibleOrders.map((order, orderIndex) => {
                            const rows = order.items.length > 0 ? order.items : [null];
                            const rowBackground = orderIndex % 2 === 0 ? "bg-white" : "bg-[#F6F3EC]";
                            return (
                                <tbody key={order.id} className="break-inside-avoid">
                                    {rows.map((item, itemIndex) => (
                                        <tr key={item?.id ?? `${order.id}-empty`} className={rowBackground}>
                                                {itemIndex === 0 && (
                                                    <td rowSpan={rows.length} className="break-words border border-black px-2 py-0.5 text-left text-gray-900">
                                                        <div>
                                                            <p className="flex flex-wrap items-center gap-1.5">
                                                                <span className="inline-flex min-w-6 items-center justify-center rounded bg-[#8A7355] px-1.5 font-semibold leading-none text-white">{orderIndex + 1}.</span>
                                                                <span>{order.public_order_number}</span>
                                                            </p>
                                                            <p><span className="font-semibold">Név:</span> {order.customerName}</p>
                                                            <p><span className="font-semibold">Tel.:</span> <span className="whitespace-nowrap">{formatPhoneNumber(order.phone)}</span></p>
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="border border-black px-1.5 py-0.5 text-center">{itemIndex + 1}.</td>
                                                <td className="break-words border border-black px-1.5 py-0.5 font-medium">{summarizeProduct(item?.products?.name)}</td>
                                                <td className="border border-black px-1.5 py-0.5 text-center font-semibold">{item ? `${item.quantity} db` : "—"}</td>
                                                <td className="break-words border border-black px-1.5 py-0.5">{summarizePrintPackage(item?.packages?.name)}</td>
                                                {(() => {
                                                    const size = item ? summarizeSize(item.size_preference) : "";
                                                    const sizeBackground = size === "Kisebb" ? "bg-[#F2A9A0]" : size === "Nagyobb" ? "bg-[#A9D48F]" : "";
                                                    return (
                                                        <td className={`break-words border border-black px-1.5 py-0.5 ${sizeBackground}`}>
                                                            {size === "Átlagos" ? "" : size}
                                                        </td>
                                                    );
                                                })()}
                                                <td className="max-w-52 break-words border border-black px-1.5 py-0.5">{item?.note || "—"}</td>
                                                <td className="border border-black px-1 py-0.5 text-center align-middle print:shadow-[inset_-1px_0_0_#000]">
                                                    <span aria-label="Teljesítési státusz jelölőnégyzet" className="inline-block h-3.5 w-3.5 rounded-[2px] border border-black bg-white print:h-3 print:w-3" />
                                                </td>
                                        </tr>
                                    ))}
                                </tbody>
                            );
                        })}
                    </table>
                </div>
                </div>
            )}
        </div>
    );
}
