"use client";

import { useMemo, useState } from "react";
import ProductSelector from "@/components/ProductSelector";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ArchiveBoxIcon } from "@heroicons/react/24/outline";
import { useOrderActionsManager } from "@/components/OrderActionsManager";

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

type ExistingOrderItem = {
    id: number;
    product_id: number;
    package_id: number;
    quantity: number;
    note: string | null;
    size_preference: string | null;
};

type EditedOrderItem = {
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

type OrderActionsProps = {
    orderId: number;
    publicOrderNumber: string;
    items: ExistingOrderItem[];
    products: Product[];
    packages: PackageOption[];
    availableStock: number;
};

export default function OrderActions({
    orderId,
    publicOrderNumber,
    items,
    products,
    packages,
    availableStock,
}: OrderActionsProps) {
    const [isEditing, setIsEditing] = useState(false);
    const {
        editingOrderId,
        startEditing,
        stopEditing,
    } = useOrderActionsManager();
    const anotherOrderIsEditing =
        editingOrderId !== null &&
        editingOrderId !== orderId;

    const [editedItems, setEditedItems] = useState<EditedOrderItem[]>([]);

    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const supabase = createClient();

    const initialItems = useMemo(
        () => [
            ...items.map((item) => ({
                selectedProductId: item.product_id,
                selectedPackageId: item.package_id,
                quantity: item.quantity,
                note: item.note ?? "",
                selectedNote:
                    item.size_preference ?? "Átlagos méret megfelelő",
                collapsed: true,
                touched: true,
                showValidation: false,
                validationPosition: "bottom" as const,

            })),

            // Üres "Új tétel" lehetőség
            {
                selectedProductId: null,
                selectedPackageId: null,
                quantity: 1,
                note: "",
                selectedNote: "Átlagos méret megfelelő",
                collapsed: true,
                touched: false,
                showValidation: false,
                validationPosition: "bottom" as const,
            },
        ],
        [items]
    );

    const originalQuantity = items.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    const maxAvailableQuantity =
        availableStock + originalQuantity;

    const stockStatus =
        maxAvailableQuantity <= 0
            ? {
                text: "Előrendelés betelt!",
                iconClass: "text-red-500",
            }
            : maxAvailableQuantity <= 30
                ? {
                    text: `Már csak ${maxAvailableQuantity} db csirke elérhető!`,
                    iconClass: "text-yellow-500",
                }
                : {
                    text: "Még több, mint 30 db csirke elérhető!",
                    iconClass: "text-[rgb(49,171,2)]",
                };

    const isUntouchedEmptyItem = (item: EditedOrderItem) =>
        item.selectedProductId === null &&
        item.selectedPackageId === null &&
        item.quantity === 1 &&
        item.note === "" &&
        item.selectedNote === "Átlagos méret megfelelő" &&
        !item.touched;

    const itemsToSave = editedItems.filter(
        (item) => !isUntouchedEmptyItem(item)
    );

    const hasChanges =
        items.length !== itemsToSave.length ||
        items.some((originalItem, index) => {
            const editedItem = itemsToSave[index];

            if (!editedItem) {
                return true;
            }

            return (
                originalItem.product_id !== editedItem.selectedProductId ||
                originalItem.package_id !== editedItem.selectedPackageId ||
                originalItem.quantity !== editedItem.quantity ||
                (originalItem.note ?? "") !== editedItem.note ||
                (originalItem.size_preference ?? "Átlagos méret megfelelő") !==
                editedItem.selectedNote
            );
        });

    const canSave =
        hasChanges &&
        itemsToSave.length > 0 &&
        itemsToSave.every(
            (item) =>
                item.selectedProductId !== null &&
                item.selectedPackageId !== null &&
                item.quantity > 0 &&
                item.collapsed
        );


    const handleEdit = () => {
        if (anotherOrderIsEditing) {
            return;
        }

        setSaveError(null);
        setSaveSuccess(null);

        startEditing(orderId);
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        stopEditing();
    };
    const router = useRouter();
    const getChangeSummary = () => {
        const oldTotal = items.reduce(
            (sum, item) => sum + item.quantity,
            0
        );

        const newTotal = itemsToSave.reduce(
            (sum, item) => sum + item.quantity,
            0
        );

        if (oldTotal !== newTotal) {
            return `Sikeres módosítás! A rendelés összmennyisége ${oldTotal}-ről ${newTotal} db-ra változott.`;
        }

        return "Sikeres módosítás! A rendelés összmennyisége nem, csak a részletek változtak.";
    };

    const handleSave = async () => {
        if (!canSave || isSaving) {
            return;
        }

        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);
        stopEditing();

        // Eredeti és módosított összmennyiség
        const oldTotal = items.reduce(
            (sum, item) => sum + item.quantity,
            0
        );

        const newTotal = itemsToSave.reduce(
            (sum, item) => sum + item.quantity,
            0
        );

        const rpcItems = itemsToSave.map((item) => ({
            product_id: item.selectedProductId,
            package_id: item.selectedPackageId,
            quantity: item.quantity,
            size_preference: item.selectedNote,
            note: item.note,
        }));

        const { error } = await supabase.rpc("update_order", {
            p_order_id: orderId,
            p_items: rpcItems,
        });

        if (error) {
            setSaveError(
                error.message || "A rendelés módosítása sikertelen."
            );

            setIsSaving(false);
            return;
        }

        // Sikeres módosítás visszajelzése
        if (oldTotal !== newTotal) {
            setSaveSuccess(
                `Sikeres módosítás! A rendelés összmennyisége ${oldTotal} db-ról ${newTotal} db-ra változott.`
            );
        } else {
            setSaveSuccess(
                "Sikeres módosítás! A rendelés összmennyisége nem, csak a részletek változtak."
            );
        }

        setIsSaving(false);
        setIsEditing(false);

        router.refresh();
    };

    return (
        <div className="w-full">

            {saveSuccess && !isEditing && (
                <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                    <p className="text-sm text-center text-[rgb(49,171,2)]">
                        {saveSuccess}
                    </p>
                </div>
            )}

            {/* Normál műveleti gombok */}
            {!isEditing && (
                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={handleEdit}
                        disabled={anotherOrderIsEditing}
                        className={`
        rounded-lg border border-gray-300
        px-4 py-2 text-sm
        transition-colors
        ${anotherOrderIsEditing
                                ? "cursor-not-allowed bg-gray-100 text-gray-300"
                                : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                            }
    `}
                    >
                        Módosítás
                    </button>

                    <button
                        type="button"
                        className="
                            rounded-lg border border-red-200
                            px-4 py-2 text-sm
                            text-red-500
                            transition-colors
                            hover:bg-red-50
                            hover:text-red-600
                        "
                    >
                        Rendelés törlése
                    </button>
                </div>
            )}


            {/* Szerkesztő */}
            {isEditing && (
                <div className="mt-4 border-t border-gray-200 pt-4">

                    {/* Szerkesztő fejléc */}
                    <div className="mb-4 w-full">

                        {/* Cím */}
                        <h3 className="text-center font-semibold text-gray-800">
                            Rendelés módosítása
                        </h3>

                        {/* Készletinformáció */}
                        <div className="mt-2 flex items-center gap-2">
                            <ArchiveBoxIcon
                                className={`h-5 w-5 ${stockStatus.iconClass}`}
                            />

                            <p className="text-sm font-medium text-gray-700">
                                {stockStatus.text}
                            </p>
                        </div>

                    </div>




                    {/* Tételek szerkesztése */}
                    <ProductSelector
                        products={products}
                        packages={packages}
                        maxAvailableQuantity={maxAvailableQuantity}
                        resetKey={0}
                        isPickupDaySelected={true}
                        initialItems={initialItems}
                        onOrderChangesChange={() => { }}
                        onItemsChange={setEditedItems}
                        onItemEdited={() => { }}
                    />

                    {saveError && (
                        <p className="mt-4 text-sm text-red-600">
                            {saveError}
                        </p>
                    )}


                    {/* Módosítás mentése */}
                    <div className="mt-5 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            className="
            rounded-lg border border-gray-300
            px-5 py-2
            text-sm font-medium text-gray-600
            transition-colors
            hover:bg-gray-50
            hover:text-gray-800
            disabled:cursor-not-allowed
            disabled:opacity-50
        "
                        >
                            Mégse
                        </button>

                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!canSave || isSaving}
                            className={`
            rounded-lg px-5 py-2
            text-sm font-medium
            transition-colors
            ${canSave && !isSaving
                                    ? `
                        bg-[rgb(49,171,2)]
                        text-white
                        hover:bg-[rgb(42,150,2)]
                      `
                                    : `
                        cursor-not-allowed
                        bg-gray-200
                        text-gray-400
                      `
                                }
        `}
                        >
                            {isSaving ? "Mentés..." : "Módosítás mentése"}
                        </button>
                    </div>

                </div>
            )}

        </div>
    );
}