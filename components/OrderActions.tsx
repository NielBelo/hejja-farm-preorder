"use client";

import { useMemo, useState } from "react";
import ProductSelector from "@/components/ProductSelector";
import PickupDayChangeCard from "@/components/PickupDayChangeCard";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useOrderActionsManager } from "@/components/OrderActionsManager";
import { usePickupDayChange, type PickupDay } from "@/lib/usePickupDayChange";
import { normalizeSizePreference } from "@/lib/sizePreferences";
import {
    updateOrder,
    type UpdateOrderItem,
} from "@/app/(protected)/history/actions";

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
    pickupDayId: number;
    pickupDays: PickupDay[];
    seasonStartDate?: string | null;
    seasonEndDate?: string | null;
    isPickupDayActive?: boolean;
};

export default function OrderActions({
    orderId,
    publicOrderNumber,
    items,
    products,
    packages,
    availableStock,
    pickupDayId,
    pickupDays,
    seasonStartDate,
    seasonEndDate,
    isPickupDayActive = true,
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
    const [emailWarning, setEmailWarning] = useState<string | null>(null);
    const [isCancelling, setIsCancelling] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const supabase = createClient();

    const initialItems = useMemo(
        () => [
            ...items.map((item) => ({
                selectedProductId: item.product_id,
                selectedPackageId: item.package_id,
                quantity: item.quantity,
                note: item.note ?? "",
                selectedNote:
                    item.size_preference ?? "Átlagos méret",
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
                selectedNote: "Átlagos méret",
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

    // Ugyanaz az összegzés, mint a PreorderManager napváltás-ellenőrzésénél:
    // az összes szerkesztett tétel mennyiségét számoljuk.
    const requiredQuantity = editedItems.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    const {
        selectedPickupDayId,
        pickupDayCardOpen,
        collapseAllSignal,
        insufficientStockDay,
        pickupDaysForPicker,
        pickupDayForDisplay,
        handleTogglePickupDayCard,
        handleSelectPickupDay,
        closePickupDayCard,
        dismissInsufficientStock,
        reset: resetPickupDaySelection,
    } = usePickupDayChange({
        pickupDayId,
        pickupDays,
        originalQuantity,
        requiredQuantity,
    });

    const isUntouchedEmptyItem = (item: EditedOrderItem) =>
        item.selectedProductId === null &&
        item.selectedPackageId === null &&
        item.quantity === 1 &&
        item.note === "" &&
        item.selectedNote === "Átlagos méret" &&
        !item.touched;

    const itemsToSave = editedItems.filter(
        (item) => !isUntouchedEmptyItem(item)
    );

    const pickupDayChanged = selectedPickupDayId !== pickupDayId;

    const hasChanges =
        pickupDayChanged ||
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
                normalizeSizePreference(originalItem.size_preference) !==
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
        if (anotherOrderIsEditing || !isPickupDayActive) {
            return;
        }

        setSaveError(null);
        setSaveSuccess(null);
        setEmailWarning(null);
        resetPickupDaySelection();

        startEditing(orderId);
        setIsEditing(true);
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        resetPickupDaySelection();
        stopEditing();
    };
    const router = useRouter();
    const handleSave = async () => {
        if (!canSave || isSaving) {
            return;
        }

        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);
        setEmailWarning(null);
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

        const rpcItems = itemsToSave.map<UpdateOrderItem>((item) => ({
            product_id: item.selectedProductId!,
            package_id: item.selectedPackageId!,
            quantity: item.quantity,
            size_preference: item.selectedNote,
            note: item.note,
        }));

        const result = await updateOrder({
            orderId,
            items: rpcItems,
            pickupDayId: selectedPickupDayId,
        });

        if (!result.success) {
            setSaveError(
                result.error || "A rendelés módosítása sikertelen."
            );

            setIsSaving(false);
            return;
        }

        const changeMessage = oldTotal !== newTotal
            ? `Sikeres módosítás! A rendelés összmennyisége ${oldTotal} db-ról ${newTotal} db-ra változott.`
            : "Sikeres módosítás! A rendelés összmennyisége nem, csak a részletek változtak.";
        const newPickupDay = pickupDays.find(
            (day) => day.id === selectedPickupDayId
        );
        const pickupDayMessage = pickupDayChanged && newPickupDay
            ? ` Az átvételi nap ${new Intl.DateTimeFormat("hu-HU", {
                year: "numeric",
                month: "long",
                day: "numeric",
            }).format(new Date(newPickupDay.pickup_date))}-re módosult.`
            : "";
        const emailMessage = result.emailRecipient
            ? ` A visszaigazolást elküldtük a(z) ${result.emailRecipient} e-mail-címre.`
            : "";

        setSaveSuccess(`${changeMessage}${pickupDayMessage}${emailMessage}`);

        setEmailWarning(result.emailWarning ?? null);

        setIsSaving(false);
        setIsEditing(false);

        router.refresh();
    };
    const handleCancelOrder = async () => {
        if (isCancelling || anotherOrderIsEditing) {
            return;
        }

        setShowCancelModal(false);
        setIsCancelling(true);
        setSaveError(null);
        setSaveSuccess(null);

        const { error } = await supabase.rpc("cancel_order", {
            p_order_id: orderId,
        });

        if (error) {
            setSaveError(
                error.message || "A rendelés törlése sikertelen."
            );
            setIsCancelling(false);
            return;
        }

        setIsCancelling(false);

        router.refresh();

    };

    return (
        <div className="w-full">

            {showCancelModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl">

                        <h2 className="text-2xl font-semibold text-gray-800">
                            Figyelem!
                        </h2>

                        <p className="mt-4 text-lg leading-7 text-gray-600">
                            Biztosan törölni szeretné a(z){" "}
                            <span className="font-semibold text-gray-800">
                                {publicOrderNumber}
                            </span>{" "}
                            azonosítójú rendelést?
                            A művelet nem vonható vissza.
                        </p>

                        <div className="mt-8 flex flex-wrap justify-end gap-3">

                            <button
                                type="button"
                                onClick={() => setShowCancelModal(false)}
                                disabled={isCancelling}
                                className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={handleCancelOrder}
                                disabled={isCancelling}
                                className="
        rounded-lg
        bg-red-600
        px-5 py-3 text-base
        font-semibold text-white
        hover:bg-red-600
        disabled:cursor-not-allowed
        disabled:opacity-50
    "
                            >
                                {isCancelling ? "Törlés..." : "Törlés"}
                            </button>

                        </div>

                    </div>
                </div>
            )}

            {saveError && !isEditing && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-center text-base text-red-600">
                        {saveError}
                    </p>
                </div>
            )}
            {saveSuccess && !isEditing && (
                <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                    <p className="text-base text-center text-[rgb(49,171,2)]">
                        {saveSuccess}
                    </p>
                </div>
            )}
            {emailWarning && !isEditing && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-center text-base text-amber-700">
                        {emailWarning}
                    </p>
                </div>
            )}

            {!isPickupDayActive && !isEditing && (
                <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-center text-sm text-gray-500">
                        Az átvételi nap jelenleg inaktív, ezért a rendelés nem módosítható. A rendelés változatlanul
                        megmarad.
                    </p>
                </div>
            )}

            {/* Normál műveleti gombok */}
            {!isEditing && (
                <div className="flex flex-wrap justify-end gap-3">
                    <button
                        type="button"
                        onClick={handleEdit}
                        disabled={anotherOrderIsEditing || !isPickupDayActive}
                        className={`
        rounded-lg border border-gray-300
        px-5 py-3 text-base font-semibold
        transition-colors
        ${anotherOrderIsEditing || !isPickupDayActive
                                ? "cursor-not-allowed bg-gray-100 text-gray-300"
                                : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                            }
    `}
                    >
                        Módosítás
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowCancelModal(true)}
                        disabled={isCancelling || anotherOrderIsEditing}
                        className={`
        rounded-lg border border-red-200
        px-5 py-3 text-base font-semibold
        transition-colors
        ${isCancelling || anotherOrderIsEditing
                                ? "cursor-not-allowed bg-gray-50 text-gray-300"
                                : "text-red-500 hover:bg-red-50 hover:text-red-600"
                            }
    `}
                    >
                        Rendelés törlése
                    </button>
                </div>
            )}


            {/* Szerkesztő */}
            {isEditing && (
                <div className="mt-4 border-t border-gray-200 pt-4">

                    {/* Szerkesztő fejléc */}
                    <div
                        id={`order-edit-${orderId}`}
                        className="mb-4 w-full scroll-mt-24"
                    >
                        {/* Cím */}
                        <h3 className="text-center text-xl font-semibold text-gray-500">
                            Rendelés módosítása
                        </h3>

                        {/* Segítő instrukció */}
                        <p className="mt-1 text-center text-base italic text-gray-600">
                            A szerkesztéshez kattintson az átvételi napra vagy a
                            módosítani kívánt tételre.
                        </p>

                    </div>

                    {/* Átvételi nap módosítása - önálló rendelési beállítás, nem tétel */}
                    <PickupDayChangeCard
                        isOpen={pickupDayCardOpen}
                        onToggle={handleTogglePickupDayCard}
                        pickupDaysForPicker={pickupDaysForPicker}
                        selectedPickupDayId={selectedPickupDayId}
                        pickupDayForDisplay={pickupDayForDisplay}
                        onSelectPickupDay={handleSelectPickupDay}
                        seasonStartDate={seasonStartDate}
                        seasonEndDate={seasonEndDate}
                        insufficientStockDay={insufficientStockDay}
                        onDismissInsufficientStock={dismissInsufficientStock}
                    />

                    {/* Tételek szerkesztése */}
                    <ProductSelector
                        orderId={orderId}
                        products={products}
                        packages={packages}
                        maxAvailableQuantity={maxAvailableQuantity}
                        resetKey={0}
                        isPickupDaySelected={true}
                        pickupDate={pickupDayForDisplay?.pickup_date ?? null}
                        initialItems={initialItems}
                        onOrderChangesChange={() => { }}
                        onItemsChange={setEditedItems}
                        onItemEdited={() => { }}
                        collapseAllSignal={collapseAllSignal}
                        onItemOpen={closePickupDayCard}
                    />

                    {saveError && (
                        <p className="mt-4 text-base text-red-600">
                            {saveError}
                        </p>
                    )}


                    {/* Módosítás mentése */}
                    <div className="mt-5 flex flex-wrap justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            className="
            rounded-lg border border-gray-300
            px-5 py-3
            text-base font-medium text-gray-600
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
            rounded-lg px-5 py-3
            text-base font-medium
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
