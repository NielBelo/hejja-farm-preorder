"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
    ChevronRightIcon,
    ChevronDownIcon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/24/outline";
import {
    canChoosePackaging,
    normalizePackageId,
} from "@/lib/orderPackaging";
import { MAX_QUANTITY_PER_ITEM } from "@/lib/orderLimits";
import { getRemainingQuantity } from "@/lib/orderQuantity";
import { getSizeRemaining, type SizeAvailability } from "@/lib/sizeAvailability";
import { DEFAULT_SIZE_PREFERENCE, normalizeSizePreference, SIZE_PREFERENCES } from "@/lib/sizePreferences";


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

type OrderItem = {
    selectedProductId: number | null;
    selectedPackageId: number | null;
    quantity: number;
    note: string;
    selectedNote: string;
    collapsed: boolean;
    touched: boolean;
    showValidation: boolean;
    validationPosition: "top" | "bottom";
};

type ProductSelectorProps = {
    orderId?: number;
    products: Product[];
    packages: PackageOption[];
    maxAvailableQuantity: number | null;
    resetKey: number;
    isPickupDaySelected: boolean;
    pickupDate?: string | null;
    onOrderChangesChange: (hasChanges: boolean) => void;
    onItemsChange: (items: OrderItem[]) => void;
    onItemEdited: () => void;
    initialItems?: OrderItem[];
    collapseAllSignal?: number;
    onItemOpen?: () => void;
    /** Bács-Kiskun vármegyei vásárlóknál a megjegyzés-mező fölötti szöveg speciális - lásd lib/countyGroups.ts BACS_KISKUN_NOTE_LABEL. */
    noteLabel?: string;
    /**
     * Az adott napon még rendelhető kisebb/nagyobb méretű csirkék darabszáma
     * (null = az adott méretre nincs korlát; a saját, már leadott rendelés
     * mennyiségét a hívó előre visszaadja). A darabszám a vásárlónak nem
     * jelenik meg, csak a mennyiségválasztót korlátozza.
     */
    sizeAvailability?: SizeAvailability | null;
    /** Termékazonosító -> ár (Ft/kg); a termékkártyán jelenik meg. */
    productPrices?: Record<number, number>;
};


const DEFAULT_NOTE = DEFAULT_SIZE_PREFERENCE;
const SIZE_PREFERENCE_LABELS: Record<typeof SIZE_PREFERENCES[number], string> = {
    "Átlagos méret": "Átlagos méret",
    "Átlagostól kisebb méret": "Átlagostól kisebb méret, ha lehet",
    "Átlagostól nagyobb méret": "Átlagostól nagyobb méret, ha lehet",
};

const formatPickupDate = (date: string) => {
    const formatted = new Intl.DateTimeFormat("hu-HU", {
        month: "long",
        day: "numeric",
    }).format(new Date(date));

    return `${formatted.charAt(0).toUpperCase()}${formatted.slice(1)}`;
};

const emptyItem = (collapsed = false): OrderItem => ({
    selectedProductId: null,
    selectedPackageId: null,
    quantity: 1,
    note: "",
    selectedNote: DEFAULT_NOTE,
    collapsed,
    touched: false,
    showValidation: false,
    validationPosition: "bottom",
});


export default function ProductSelector({
    orderId,
    products,
    packages,
    maxAvailableQuantity,
    resetKey,
    isPickupDaySelected,
    pickupDate,
    onOrderChangesChange,
    onItemsChange,
    onItemEdited,
    initialItems,
    collapseAllSignal,
    onItemOpen,
    noteLabel = "Opcionális megjegyzés a csomaghoz",
    sizeAvailability = null,
    productPrices,
}: ProductSelectorProps) {
    const itemHasContent = (item: OrderItem) =>
        item.selectedProductId !== null ||
        item.selectedPackageId !== null ||
        item.note.trim() !== "" ||
        item.quantity !== 1 ||
        item.selectedNote !== DEFAULT_NOTE;

    const buildInitialItems = () =>
        initialItems && initialItems.length > 0
            ? initialItems.map((item) => ({ ...item, selectedNote: normalizeSizePreference(item.selectedNote) }))
            : [emptyItem(!isPickupDaySelected)];

    const [items, setItems] = useState<OrderItem[]>(buildInitialItems);

    const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);

    useEffect(() => {
        if (!zoomedImage) return;
        const close = (event: KeyboardEvent) => {
            if (event.key === "Escape") setZoomedImage(null);
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [zoomedImage]);

    // Ha a már megadott mennyiség nem fér bele a választott méret keretébe,
    // a vásárló megerősítése után a mennyiség a maximumra módosul.
    const [sizeOverwrite, setSizeOverwrite] = useState<{ index: number; size: string; max: number } | null>(null);

    // A szülő jelzései (összecsukás, alaphelyzetbe állítás) renderelés közben
    // kerülnek a state-be, nem effektben: így nincs felesleges, kaszkádoló
    // újrarenderelés. A sorrend számít: az alaphelyzetbe állítás az
    // összecsukás után fut, ezért ha egyszerre érkeznek, az győz.
    const [seenCollapseAllSignal, setSeenCollapseAllSignal] = useState(collapseAllSignal);
    if (collapseAllSignal !== seenCollapseAllSignal) {
        setSeenCollapseAllSignal(collapseAllSignal);
        if (collapseAllSignal !== undefined) {
            setItems((prev) =>
                prev.map((item) => ({ ...item, collapsed: true, showValidation: false }))
            );
        }
    }

    const [seenReset, setSeenReset] = useState({ resetKey, isPickupDaySelected, initialItems });
    if (
        seenReset.resetKey !== resetKey ||
        seenReset.isPickupDaySelected !== isPickupDaySelected ||
        seenReset.initialItems !== initialItems
    ) {
        setSeenReset({ resetKey, isPickupDaySelected, initialItems });
        setItems(buildInitialItems());
    }

    useEffect(() => {
        const hasChanges = items.some(item => itemHasContent(item));

        onOrderChangesChange(hasChanges);
        onItemsChange(items);
    }, [items, onOrderChangesChange, onItemsChange]);

    const itemRequiresPackaging = (item: OrderItem) =>
        canChoosePackaging(
            products.find((product) => product.id === item.selectedProductId),
            item.quantity,
        );

    const updateItem = (index: number, changes: Partial<OrderItem>) => {
        onItemEdited();

        setItems((prev) => {

            const remaining = getRemainingQuantity(prev, index, maxAvailableQuantity);
            const sizeRemaining = getSizeRemaining(
                prev,
                index,
                changes.selectedNote ?? prev[index].selectedNote,
                sizeAvailability,
            );
            const sizeCap = sizeRemaining === null ? Infinity : Math.max(1, sizeRemaining);

            const updated = prev.map((item, i) => {
                if (i !== index) return item;

                const newQuantity =
                    changes.quantity !== undefined
                        ? Math.min(
                            remaining,
                            sizeCap,
                            MAX_QUANTITY_PER_ITEM,
                            Math.max(1, changes.quantity)
                        )
                        : item.quantity;

                const nextItem = {
                    ...item,
                    ...changes,
                    quantity: newQuantity,
                    touched: true,
                    showValidation: false,
                };

                const selectedProduct = products.find(
                    (product) => product.id === nextItem.selectedProductId,
                );

                return {
                    ...nextItem,
                    selectedPackageId: normalizePackageId({
                        product: selectedProduct,
                        quantity: nextItem.quantity,
                        selectedPackageId: nextItem.selectedPackageId,
                        packages,
                    }),
                };
            });

            return updated;
        });
    };

    const selectSize = (index: number, size: (typeof SIZE_PREFERENCES)[number]) => {
        const remaining = getSizeRemaining(items, index, size, sizeAvailability);

        if (remaining === null || items[index].quantity <= remaining) {
            updateItem(index, { selectedNote: size });
            return;
        }

        if (remaining > 0) setSizeOverwrite({ index, size, max: remaining });
    };

    const confirmSizeOverwrite = () => {
        if (!sizeOverwrite) return;
        updateItem(sizeOverwrite.index, { selectedNote: sizeOverwrite.size, quantity: sizeOverwrite.max });
        setSizeOverwrite(null);
    };

    const resetItem = (index: number) => {
        setItems((prev) => {
            // A kiválasztott tétel tényleges eltávolítása
            const remainingItems = prev.filter((_, i) => i !== index);

            // Az összes üres helyőrző eltávolítása
            const contentItems = remainingItems.filter((item) =>
                itemHasContent(item)
            );

            // Ha már egyetlen kitöltött tétel sincs,
            // csak egy alapértelmezett első tétel maradjon
            if (contentItems.length === 0) {
                return [emptyItem(!isPickupDaySelected)];
            }

            const lastItem = contentItems[contentItems.length - 1];

            const lastItemIsComplete =
                lastItem.selectedProductId !== null &&
                (!itemRequiresPackaging(lastItem) || lastItem.selectedPackageId !== null);

            // Csak befejezhető utolsó tétel után jelenjen meg
            // pontosan egy új, összecsukott tétel
            if (lastItemIsComplete) {
                return [...contentItems, emptyItem(true)];
            }

            return contentItems;
        });
    };

    const finishItem = (
    index: number,
    validationPosition: "top" | "bottom" = "bottom"
) => {
    const currentItem = items[index];

    if (
        currentItem.selectedProductId === null ||
        (itemRequiresPackaging(currentItem) && currentItem.selectedPackageId === null)
    ) {
        setItems((prev) =>
            prev.map((item, i) =>
                i === index
                    ? {
                        ...item,
                        showValidation: true,
                        validationPosition,
                    }
                    : item
            )
        );

        return;
    }

    setItems((prev) => {
        const updated = prev.map((item, i) =>
            i === index
                ? {
                    ...item,
                    collapsed: true,
                    showValidation: false,
                }
                : item
        );

        const isLastItem = index === updated.length - 1;

        if (isLastItem) {
            updated.push(emptyItem(true));
        }

        return updated;
    });

    requestAnimationFrame(() => {
        document
            .getElementById(`order-edit-${orderId}`)
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
    });
};

    const toggleItem = (index: number, canOpen: boolean) => {
        if (!canOpen) return;

        const willOpen = items[index].collapsed;

        const openItemIndex = items.findIndex(
            (item, i) => !item.collapsed && i !== index
        );

        // Van egy másik, jelenleg nyitott tétel
        if (openItemIndex !== -1) {
            const openItem = items[openItemIndex];

            const isComplete =
                openItem.selectedProductId !== null &&
                (!itemRequiresPackaging(openItem) || openItem.selectedPackageId !== null);

            // A nyitott tétel még nincs befejezve
            if (!isComplete) {
                setItems((prev) =>
                    prev.map((item, i) =>
                        i === openItemIndex
                            ? {
                                ...item,
                                showValidation: true,
                                validationPosition: "top",
                            }
                            : item
                    )
                );

                return;
            }
        }

        setItems((prev) =>
            prev.map((currentItem, currentIndex) => ({
                ...currentItem,
                collapsed:
                    currentIndex === index
                        ? !currentItem.collapsed
                        : true,
            }))
        );

        if (willOpen) {
            onItemOpen?.();
        }
    };

    const getHeaderText = (item: OrderItem, index: number) => {

    const selectedProduct = products.find(
        (p) => p.id === item.selectedProductId
    );

    const selectedPackage = packages.find(
        (p) => p.id === item.selectedPackageId
    );

    const sizeText = normalizeSizePreference(item.selectedNote);

    if (!item.touched && !itemHasContent(item)) {
        return item.collapsed ? "Új tétel" : `${index + 1}. tétel`;
    }

    const details = [
        selectedProduct?.name,
        selectedProduct && `${item.quantity} db`,
        itemRequiresPackaging(item) && selectedPackage?.name,
        selectedProduct && sizeText,
        pickupDate && formatPickupDate(pickupDate),
        item.note,
    ].filter(Boolean);

    return details.length === 0
        ? `${index + 1}. tétel`
        : `${index + 1}. tétel # ${details.join(" / ")}`;
};


    return (


        <div>

            {items.map((item, index) => {
                const previousItem = index > 0 ? items[index - 1] : null;
                const canOpen =
                    isPickupDaySelected &&
                    (
                        !previousItem ||
                        (
                            previousItem.selectedProductId !== null &&
                            previousItem.selectedPackageId !== null
                        )
                    );
                const marginClass = "mt-4"

                const missingProduct = !item.selectedProductId;
                const missingPackaging =
                    itemRequiresPackaging(item) && !item.selectedPackageId;
                const validationMessage =
                    missingProduct && missingPackaging
                        ? "Fejezze be a tétel kitöltését! (Hiányzik a termék és a csomagolás.)"
                        : missingProduct
                            ? "Fejezze be a tétel kitöltését! (Hiányzik a termék.)"
                            : missingPackaging
                                ? "Fejezze be a tétel kitöltését! (Hiányzik a csomagolás.)"
                                : "";

                const isAddNewButton =
                    index > 0 &&
                    index === items.length - 1 &&
                    canOpen &&
                    item.collapsed &&
                    !itemHasContent(item);

                const showPickupDayHint = !isPickupDaySelected && index === 0;

                if (isAddNewButton) {
                    return (
                        <div key={index} className={`${marginClass} flex justify-center`}>
                            <button
                                type="button"
                                onClick={() => toggleItem(index, canOpen)}
                                className="rounded-lg border-2 border-[rgb(92,113,190)] px-6 py-2 text-base font-semibold text-[rgb(92,113,190)] transition hover:bg-[rgb(92,113,190)] hover:text-white"
                            >
                                + Új tétel hozzáadása
                            </button>
                        </div>
                    );
                }

                return (
                    <div
                        key={index}
                        className={`
            ${marginClass}
            overflow-hidden rounded-xl border border-gray-200 shadow-sm
        `}
                    >
                        <div
                            role="button"
                            tabIndex={canOpen ? 0 : -1}
                            title={canOpen ? undefined : "Előbb fejezze be az előző tételt (termék és csomagolás kiválasztásával)!"}
                            onClick={() => {
                                if (!canOpen) return;

                                if (item.collapsed) {
                                    toggleItem(index, canOpen);
                                } else if (itemHasContent(item)) {
                                    finishItem(index, "top");
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();

                                    if (!canOpen) return;

                                    if (item.collapsed) {
                                        toggleItem(index, canOpen);
                                    } else if (itemHasContent(item)) {
                                        finishItem(index, "top");
                                    }
                                }
                            }}
                            className={`
    flex items-center justify-between
    px-6 py-2
    ${item.collapsed ? "rounded-xl" : "rounded-t-xl rounded-b-none"}
    border-2 border-[rgb(92,113,190)] bg-[rgb(92,113,190)] text-white
    ${canOpen
                                    ? "cursor-pointer hover:brightness-95"
                                    : "cursor-not-allowed opacity-60"
                                }
`}
                        >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                {!itemHasContent(item) && item.collapsed ? (
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-2xl font-medium">
                                        +
                                    </span>
                                ) : item.collapsed ? (
                                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
                                ) : (
                                    <ChevronDownIcon className="h-5 w-5 shrink-0" />
                                )}

                                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                    <h2
                                        className={
                                            showPickupDayHint
                                                ? "shrink-0 text-lg font-semibold"
                                                : "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-lg font-semibold [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent_100%)]"
                                        }
                                    >
                                        {getHeaderText(item, index)}
                                    </h2>

                                    {showPickupDayHint && (
                                        <span className="truncate text-base font-normal italic opacity-80">
                                            - A rendelési tételek megadásához először válasszon átvételi napot!
                                        </span>
                                    )}
                                </div>
                            </div>

                            {isPickupDaySelected && (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        resetItem(index);
                                    }}
                                    className="rounded p-1 transition hover:bg-white/10"
                                    title="Tétel törlése"
                                >
                                    <TrashIcon className="h-6 w-6 text-white" />
                                </button>
                            )}
                        </div>

                        {!item.collapsed && (

                            <div className="bg-white p-4">
                                {item.showValidation && item.validationPosition === "top" && (
                                    <p className="mb-4 text-center text-base font-medium text-red-600">
                                        {validationMessage}
                                    </p>
                                )}
                                <h3 className="mb-4 text-center text-xl font-semibold text-gray-700">
                                    Válasszon terméket!
                                </h3>

                                <div className="grid gap-4 md:grid-cols-3">
                                    {products.map((product) => {
                                        const selected = item.selectedProductId === product.id;

                                        return (
                                            <button
                                                key={product.id}
                                                onClick={() =>
                                                    updateItem(index, { selectedProductId: product.id })
                                                }
                                                type="button"
                                                className={`
                          h-full rounded-xl border p-5 text-left transition-all
                          ${selected
                                                        ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                        : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                    }
                        `}
                                            >
                                                <div className="flex h-full flex-col gap-3">
                                                    {product.image_url && (
                                                        <span
                                                            role="button"
                                                            tabIndex={0}
                                                            title="Kattintson a kép nagyításához"
                                                            aria-label={`${product.name} képének nagyítása`}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setZoomedImage({ src: product.image_url!, alt: product.name });
                                                            }}
                                                            onKeyDown={(event) => {
                                                                if (event.key === "Enter" || event.key === " ") {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    setZoomedImage({ src: product.image_url!, alt: product.name });
                                                                }
                                                            }}
                                                            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg"
                                                        >
                                                            <Image
                                                                src={product.image_url}
                                                                alt={product.name}
                                                                width={320}
                                                                height={200}
                                                                className="block h-auto w-full"
                                                            />
                                                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 px-3 text-center text-base font-semibold text-white opacity-0 transition group-hover:bg-black/55 group-hover:opacity-100 group-focus-visible:bg-black/55 group-focus-visible:opacity-100">
                                                                Kattintson a nagyításhoz
                                                            </span>
                                                        </span>
                                                    )}

                                                    <div className="flex flex-1 flex-col items-center text-center">
                                                        <h3 className="text-lg font-semibold text-gray-700">
                                                            {product.name}
                                                        </h3>

                                                        <p className="mt-1 mb-2 text-base text-gray-500">
                                                            {product.description}
                                                        </p>

                                                        {productPrices?.[product.id] !== undefined && (
                                                            <p className="mt-auto inline-block rounded-full bg-[rgba(92,113,190,0.12)] px-3 py-1 text-base font-bold text-[rgb(72,93,162)]">
                                                                {productPrices[product.id].toLocaleString("hu-HU")} Ft/kg
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-6">
                                    <h3 className="mb-4 text-center text-xl font-semibold text-gray-700">
                                        Adja meg a mennyiséget!
                                    </h3>

                                    <div className="flex items-center justify-center gap-5">
                                        <button
                                            onClick={() =>
                                                updateItem(index, {
                                                    quantity: Math.max(1, item.quantity - 1),
                                                })
                                            }
                                            type="button"
                                            className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-xl font-semibold text-gray-700 transition hover:bg-gray-100"
                                        >
                                            −
                                        </button>

                                        <div className="flex items-center gap-0">
                                            <input
                                                type="number"
                                                min={1}
                                                max={MAX_QUANTITY_PER_ITEM}
                                                value={item.quantity}
                                                onChange={(e) =>
                                                    updateItem(index, {
                                                        quantity: Math.min(
                                                            MAX_QUANTITY_PER_ITEM,
                                                            Math.max(1, Number(e.target.value) || 1)
                                                        ),
                                                    })
                                                }
                                                className="w-12 bg-transparent text-center text-xl font-semibold text-gray-700 outline-none"
                                            />
                                            <span className="text-xl text-gray-700">db</span>
                                        </div>

                                        <button
                                            onClick={() =>
                                                updateItem(index, {
                                                    quantity: Math.min(MAX_QUANTITY_PER_ITEM, item.quantity + 1),
                                                })
                                            }
                                            type="button"
                                            className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-xl font-semibold text-gray-700 transition hover:bg-gray-100"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {canChoosePackaging(
                                    products.find((product) => product.id === item.selectedProductId),
                                    item.quantity,
                                ) && <div className="mt-6">
                                    <h3 className="mb-4 text-center text-xl font-semibold text-gray-700">
                                        Válasszon csomagolási módot!
                                    </h3>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        {[...packages]
                                            .sort((a, b) => a.name.localeCompare(b.name, "hu-HU"))
                                            .map((pack) => {
                                            const selected = item.selectedPackageId === pack.id;

                                            return (
                                                <button
                                                    key={pack.id}
                                                    onClick={() =>
                                                        updateItem(index, { selectedPackageId: pack.id })
                                                    }
                                                    type="button"
                                                    className={`
                            rounded-xl border p-5 text-left transition-all
                            ${selected
                                                            ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                            : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                        }
                          `}
                                                >
                                                    <h3 className="text-lg font-semibold text-gray-700">
                                                        {pack.name}
                                                    </h3>

                                                    <p className="mt-1 text-base text-gray-500">
                                                        {pack.description}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>}

                                <div className="mt-6">
                                    <h3 className="mb-4 text-center text-xl font-semibold text-gray-700">
                                        {noteLabel}
                                    </h3>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <textarea
                                            value={item.note}
                                            onChange={(e) =>
                                                updateItem(index, { note: e.target.value })
                                            }
                                            placeholder="Ide írhat egyedi megjegyzést..."
                                            className="min-h-32 resize-none rounded-xl border border-[rgba(7,109,143,0.4)] p-4 text-base text-gray-700 outline-none transition focus:border-[rgb(49,171,2)]"
                                        />

                                        <div className="grid gap-3">
                                            {SIZE_PREFERENCES.map((option) => {
                                                const selected = item.selectedNote === option;
                                                const soldOut =
                                                    !selected && getSizeRemaining(items, index, option, sizeAvailability) === 0;

                                                return (
                                                    <button
                                                        type="button"
                                                        key={option}
                                                        disabled={soldOut}
                                                        onClick={() => selectSize(index, option)}
                                                        className={`
                              rounded-xl border p-4 text-left text-base transition-all
                              ${selected
                                                                ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                                : soldOut
                                                                    ? "cursor-not-allowed border-2 border-gray-200 bg-gray-100 text-gray-400"
                                                                    : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                            }
                            `}
                                                    >
                                                        {SIZE_PREFERENCE_LABELS[option]}
                                                        {soldOut && (
                                                            <span className="mt-1 block text-sm">
                                                                Erre a napra ebből a méretből már nem rendelhető.
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8 border-t border-gray-200 pt-6">

                                    {item.showValidation && item.validationPosition === "bottom" && (
                                        <p className="mb-4 text-center text-base font-medium text-red-600">
                                            {validationMessage}
                                        </p>
                                    )}

                                    <div className="flex justify-center">
                                        <button
                                            onClick={() => finishItem(index, "bottom")}
                                            type="button"
                                            className="
            rounded-lg border border-[rgb(92,113,190)]
            bg-[rgb(92,113,190)] px-6 py-3
            text-base font-semibold text-white
            transition
            hover:bg-[rgb(72,93,162)] hover:text-white/90
        "
                                        >
                                            ✓ Tétel kész, összecsukás
                                        </button>
                                    </div>

                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {zoomedImage && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={zoomedImage.alt}
                    onClick={() => setZoomedImage(null)}
                    className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-4"
                >
                    <button
                        type="button"
                        onClick={() => setZoomedImage(null)}
                        aria-label="Kép bezárása"
                        title="Bezárás"
                        className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-base font-semibold text-gray-800 shadow-lg transition hover:bg-gray-100"
                    >
                        <XMarkIcon aria-hidden="true" className="h-5 w-5" />
                        Bezárás
                    </button>
                    <Image
                        src={zoomedImage.src}
                        alt={zoomedImage.alt}
                        width={1600}
                        height={1000}
                        onClick={(event) => event.stopPropagation()}
                        className="h-auto max-h-[85vh] w-auto max-w-full cursor-default rounded-lg object-contain shadow-xl"
                    />
                </div>
            )}

            {sizeOverwrite && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl">
                        <h2 className="text-2xl font-semibold text-gray-800">Figyelem!</h2>

                        <p className="mt-4 text-lg leading-7 text-gray-600">
                            A kiválasztott méretből erre a napra legfeljebb {sizeOverwrite.max} db rendelhető. Ha
                            folytatja, a megadott mennyiség erre az értékre módosul.
                        </p>

                        <div className="mt-8 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setSizeOverwrite(null)}
                                className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={confirmSizeOverwrite}
                                className="rounded-lg bg-[rgb(49,171,2)] px-5 py-3 text-base font-semibold text-white hover:brightness-95"
                            >
                                OK, mennyiség módosítása
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
