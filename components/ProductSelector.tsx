"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
    ChevronRightIcon,
    ChevronDownIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";


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
    products: Product[];
    packages: PackageOption[];
    maxAvailableQuantity: number | null;
    resetKey: number;
    isPickupDaySelected: boolean;
    onOrderChangesChange: (hasChanges: boolean) => void;
    onItemsChange: (items: OrderItem[]) => void;
    onItemEdited: () => void;
    initialItems?: OrderItem[];
};

const DEFAULT_NOTE = "Átlagos méret megfelelő";

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
    products,
    packages,
    maxAvailableQuantity,
    resetKey,
    isPickupDaySelected,
    onOrderChangesChange,
    onItemsChange,
    onItemEdited,
    initialItems,
}: ProductSelectorProps) {
    const [items, setItems] = useState<OrderItem[]>(() =>
        initialItems && initialItems.length > 0
            ? initialItems
            : [emptyItem(true)]
    );

    useEffect(() => {
        const hasChanges = items.some(item => itemHasContent(item));

        onOrderChangesChange(hasChanges);
        onItemsChange(items);
    }, [items, onOrderChangesChange, onItemsChange]);
    useEffect(() => {
        if (initialItems && initialItems.length > 0) {
            setItems(initialItems);
            return;
        }

        setItems([
            emptyItem(!isPickupDaySelected)
        ]);
    }, [resetKey, isPickupDaySelected, initialItems]);

    const itemHasContent = (item: OrderItem) =>
        item.selectedProductId !== null ||
        item.selectedPackageId !== null ||
        item.note.trim() !== "" ||
        item.quantity !== 1 ||
        item.selectedNote !== DEFAULT_NOTE;

    const getRemainingQuantity = (items: OrderItem[], currentIndex: number) => {
        const used = items.reduce((sum, item, index) => {
            if (index === currentIndex) return sum;
            return sum + item.quantity;
        }, 0);

        return Math.max(
            1,
            (maxAvailableQuantity ?? 100) - used
        );
    };



    const updateItem = (index: number, changes: Partial<OrderItem>) => {
        onItemEdited();

        setItems((prev) => {

            const remaining = getRemainingQuantity(prev, index);

            const updated = prev.map((item, i) => {
                if (i !== index) return item;

                const newQuantity =
                    changes.quantity !== undefined
                        ? Math.min(
                            remaining,
                            Math.max(1, changes.quantity)
                        )
                        : item.quantity;

                return {
                    ...item,
                    ...changes,
                    quantity: newQuantity,
                    touched: true,
                    showValidation: false,
                };
            });

            return updated;
        });
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
                lastItem.selectedPackageId !== null;

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
        setItems((prev) => {
            const currentItem = prev[index];

            if (
                currentItem.selectedProductId === null ||
                currentItem.selectedPackageId === null
            ) {
                return prev.map((item, i) =>
                    i === index
                        ? {
                            ...item,
                            showValidation: true,
                            validationPosition,
                        }
                        : item
                );
            }

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
    };

    const toggleItem = (index: number, canOpen: boolean) => {
        if (!canOpen) return;

        const openItemIndex = items.findIndex(
            (item, i) => !item.collapsed && i !== index
        );

        // Van egy másik, jelenleg nyitott tétel
        if (openItemIndex !== -1) {
            const openItem = items[openItemIndex];

            const isComplete =
                openItem.selectedProductId !== null &&
                openItem.selectedPackageId !== null;

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
    };

    const getHeaderText = (item: OrderItem, index: number) => {
        const selectedProduct = products.find((p) => p.id === item.selectedProductId);
        const selectedPackage = packages.find((p) => p.id === item.selectedPackageId);

        const sizeText =
            item.selectedNote === "Átlagostól inkább kisebbet kérek, ha lehet"
                ? "Átlagostól kisebb méret"
                : item.selectedNote === "Átlagostól inkább nagyobbat kérek, ha lehet"
                    ? "Átlagostól nagyobb méret"
                    : "Átlagos méret";

        if (!item.touched && !itemHasContent(item)) {
            return "Új tétel";
        }

        const details = [
            selectedProduct?.name,
            selectedProduct && `${item.quantity} db`,
            selectedPackage?.name,
            selectedProduct && sizeText,
            item.note &&
            (item.note.length > 30 ? `${item.note.slice(0, 30)}...` : item.note),
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

                const validationMessage =
                    !item.selectedProductId && !item.selectedPackageId
                        ? "Fejezze be a tétel kitöltését! (Hiányzik a termék és a csomagolás.)"
                        : !item.selectedProductId
                            ? "Fejezze be a tétel kitöltését! (Hiányzik a termék.)"
                            : "Fejezze be a tétel kitöltését! (Hiányzik a csomagolás.)";


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
                            onClick={() => {
                                if (!canOpen) return;

                                if (item.collapsed) {
                                    toggleItem(index, canOpen);
                                } else {
                                    finishItem(index, "top");
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();

                                    if (!canOpen) return;

                                    if (item.collapsed) {
                                        toggleItem(index, canOpen);
                                    } else {
                                        finishItem(index, "top");
                                    }
                                }
                            }}
                            className={`
    flex items-center justify-between
    rounded-xl px-6 py-2
    ${!item.touched && !itemHasContent(item)
                                    ? "border sm border-gray-200 bg-white shadow-x1 text-[rgb(145,155,160)]"
                                    : "border-[rgb(145,155,160)] bg-[rgb(145,155,160)] text-white"
                                }
    ${canOpen
                                    ? "cursor-pointer hover:brightness-95"
                                    : "cursor-not-allowed opacity-60"
                                }
`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                {!itemHasContent(item) ? (
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xl font-medium">
                                        +
                                    </span>
                                ) : item.collapsed ? (
                                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
                                ) : (
                                    <ChevronDownIcon className="h-5 w-5 shrink-0" />
                                )}

                                <div className="flex min-w-0 items-center gap-2">
                                    <h2 className="shrink-0 text-sm font-semibold">
                                        {getHeaderText(item, index)}
                                    </h2>

                                    {!isPickupDaySelected && index === 0 && (
                                        <span className="truncate text-xs font-normal italic opacity-80">
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
                                    <TrashIcon className="h-5 w-5 text-white" />
                                </button>
                            )}
                        </div>

                        {!item.collapsed && (

                            <div className="bg-white p-4">
                                {item.showValidation && item.validationPosition === "top" && (
                                    <p className="mb-4 text-center text-sm font-medium text-red-600">
                                        {validationMessage}
                                    </p>
                                )}
                                <h3 className="mb-4 text-center text-base font-semibold text-gray-700">
                                    Válasszon terméket!
                                </h3>

                                <div className="grid gap-4 md:grid-cols-2">
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
                          rounded-xl border p-4 text-left transition-all
                          ${selected
                                                        ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                        : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                    }
                        `}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="flex-1">
                                                        <h3 className="text-base font-semibold text-gray-700">
                                                            {product.name}
                                                        </h3>

                                                        <p className="mt-1 text-sm text-gray-500">
                                                            {product.description}
                                                        </p>
                                                    </div>

                                                    {product.image_url && (
                                                        <Image
                                                            src={product.image_url}
                                                            alt={product.name}
                                                            width={160}
                                                            height={100}
                                                            className="rounded-lg object-cover"
                                                        />
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-6">
                                    <h3 className="mb-4 text-center text-base font-semibold text-gray-700">
                                        Adja meg a mennyiséget!
                                    </h3>

                                    <div className="flex items-center justify-center gap-4">
                                        <button
                                            onClick={() =>
                                                updateItem(index, {
                                                    quantity: Math.max(1, item.quantity - 1),
                                                })
                                            }
                                            type="button"
                                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-lg font-semibold text-gray-700 transition hover:bg-gray-100"
                                        >
                                            −
                                        </button>

                                        <div className="flex items-center gap-0">
                                            <input
                                                type="number"
                                                min={1}
                                                max={100}
                                                value={item.quantity}
                                                onChange={(e) =>
                                                    updateItem(index, {
                                                        quantity: Math.min(
                                                            100,
                                                            Math.max(1, Number(e.target.value) || 1)
                                                        ),
                                                    })
                                                }
                                                className="w-10 bg-transparent text-center text-lg font-semibold text-gray-700 outline-none"
                                            />
                                            <span className="text-lg text-gray-700">db</span>
                                        </div>

                                        <button
                                            onClick={() =>
                                                updateItem(index, {
                                                    quantity: Math.min(100, item.quantity + 1),
                                                })
                                            }
                                            type="button"
                                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 text-lg font-semibold text-gray-700 transition hover:bg-gray-100"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-6">
                                    <h3 className="mb-4 text-center text-base font-semibold text-gray-700">
                                        Válasszon csomagolási módot!
                                    </h3>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        {packages.map((pack) => {
                                            const selected = item.selectedPackageId === pack.id;

                                            return (
                                                <button
                                                    key={pack.id}
                                                    onClick={() =>
                                                        updateItem(index, { selectedPackageId: pack.id })
                                                    }
                                                    type="button"
                                                    className={`
                            rounded-xl border p-4 text-left transition-all
                            ${selected
                                                            ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                            : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                        }
                          `}
                                                >
                                                    <h3 className="text-base font-semibold text-gray-700">
                                                        {pack.name}
                                                    </h3>

                                                    <p className="mt-1 text-sm text-gray-500">
                                                        {pack.description}
                                                    </p>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="mt-6">
                                    <h3 className="mb-4 text-center text-base font-semibold text-gray-700">
                                        Opcionális megjegyzés a csomaghoz
                                    </h3>

                                    <div className="grid gap-4 md:grid-cols-2">
                                        <textarea
                                            value={item.note}
                                            onChange={(e) =>
                                                updateItem(index, { note: e.target.value })
                                            }
                                            placeholder="Ide írhat egyedi megjegyzést..."
                                            className="min-h-32 resize-none rounded-xl border border-[rgba(7,109,143,0.4)] p-4 text-sm text-gray-700 outline-none transition focus:border-[rgb(49,171,2)]"
                                        />

                                        <div className="grid gap-3">
                                            {[
                                                "Átlagos méret megfelelő",
                                                "Átlagostól inkább kisebbet kérek, ha lehet",
                                                "Átlagostól inkább nagyobbat kérek, ha lehet",
                                            ].map((option) => {
                                                const selected = item.selectedNote === option;

                                                return (
                                                    <button
                                                        type="button"
                                                        key={option}
                                                        onClick={() =>
                                                            updateItem(index, { selectedNote: option })
                                                        }
                                                        className={`
                              rounded-xl border p-4 text-left text-sm transition-all
                              ${selected
                                                                ? "border-2 border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] shadow-md"
                                                                : "border-2 border-[rgba(7,109,143,0.2)] hover:border-[rgb(49,171,2)] hover:bg-gray-50"
                                                            }
                            `}
                                                    >
                                                        {option}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-8 border-t border-gray-200 pt-6">

                                    {item.showValidation && item.validationPosition === "bottom" && (
                                        <p className="mb-4 text-center text-sm font-medium text-red-600">
                                            {validationMessage}
                                        </p>
                                    )}

                                    <div className="flex justify-center">
                                        <button
                                            onClick={() => finishItem(index, "bottom")}
                                            type="button"
                                            className="
            rounded-lg border border-gray-300
            bg-[rgb(145,155,160)] px-5 py-2
            text-sm font-medium text-white
            transition
            hover:bg-[rgb(133,144,149)] hover:text-white/90
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
        </div>
    );
}