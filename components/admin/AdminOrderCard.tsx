"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveBoxIcon } from "@heroicons/react/24/outline";

import AdminOrderItems from "@/components/admin/AdminOrderItems";
import ProductSelector from "@/components/ProductSelector";
import { createClient } from "@/lib/supabase/client";

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

type AdminOrderItem = {
    id: number;
    product_id: number;
    package_id: number;
    quantity: number;
    size_preference: string;
    note: string | null;
    products: {
        id: number;
        name: string;
    } | null;
    packages: {
        id: number;
        name: string;
    } | null;
};

type AdminOrderVersion = {
    id: number;
    version_number: number;
    created_at: string;
    order_items: AdminOrderItem[];
};

type AdminPickupDay = {
    id: number;
    pickup_date: string;
    serial_number: number;
    available_stock: number;
    planned_stock: number;
};

type AdminProfile = {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    city: string;
    county: string | null;
};

export type AdminOrder = {
    id: number;
    public_order_number: string;
    status: string;
    created_at: string;
    current_version_id: number;
    user_id: string;
    pickup_day_id: number;
    pickup_days: AdminPickupDay;
    order_versions: AdminOrderVersion;
    profile: AdminProfile | null;
};

export default function AdminOrderCard({
    order,
    products,
    packages,
    isOpen,
    onToggle,
}: {
    order: AdminOrder;
    products: Product[];
    packages: PackageOption[];
    isOpen: boolean;
    onToggle: () => void;
}) {
    const router = useRouter();
    const supabase = createClient();

    const [isEditing, setIsEditing] = useState(false);
    const [editedItems, setEditedItems] = useState<EditedOrderItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

    // ------------------------------------------------------------
    // Aktuális rendelési tételek
    // ------------------------------------------------------------
    const items = order.order_versions?.order_items ?? [];

    const totalQuantity = items.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    // ------------------------------------------------------------
    // ProductSelector kezdőállapot
    // ------------------------------------------------------------
    const initialItems = useMemo<EditedOrderItem[]>(
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

    // ------------------------------------------------------------
    // Szerkeszthető maximális mennyiség
    // ------------------------------------------------------------
    const originalQuantity = items.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

    const maxAvailableQuantity =
        order.pickup_days.available_stock + originalQuantity;

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

    // ------------------------------------------------------------
    // Érintetlen üres "Új tétel"
    // ------------------------------------------------------------
    const isUntouchedEmptyItem = (item: EditedOrderItem) =>
        item.selectedProductId === null &&
        item.selectedPackageId === null &&
        item.quantity === 1 &&
        item.note === "" &&
        item.selectedNote === "Átlagos méret megfelelő" &&
        !item.touched;

    // ------------------------------------------------------------
    // Mentendő tételek
    // ------------------------------------------------------------
    const itemsToSave = editedItems.filter(
        (item) => !isUntouchedEmptyItem(item)
    );

    // ------------------------------------------------------------
    // Van-e tényleges módosítás?
    // ------------------------------------------------------------
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
                (originalItem.size_preference ??
                    "Átlagos méret megfelelő") !==
                    editedItem.selectedNote
            );
        });

    // ------------------------------------------------------------
    // Pont ugyanaz a mentési feltétel, mint a History oldalon:
    // - legyen tényleges módosítás
    // - legyen legalább egy tétel
    // - minden tétel legyen teljes és összecsukva
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // ProductSelector callbackek
    // ------------------------------------------------------------
    const handleOrderChangesChange = useCallback(
        (_hasChanges: boolean) => {},
        []
    );

    const handleItemsChange = useCallback(
        (newItems: EditedOrderItem[]) => {
            setEditedItems(newItems);
        },
        []
    );

    const handleItemEdited = useCallback(() => {}, []);

    // ------------------------------------------------------------
    // Átvételi dátum
    // ------------------------------------------------------------
    const pickupDate = new Date(
        order.pickup_days.pickup_date
    ).toLocaleDateString("hu-HU", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    // ------------------------------------------------------------
    // Utolsó módosítás
    // ------------------------------------------------------------
    const lastModified = new Date(
        order.order_versions.created_at
    ).toLocaleString("hu-HU", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });

    // ------------------------------------------------------------
    // Vásárló
    // ------------------------------------------------------------
    const customerName = order.profile
        ? `${order.profile.last_name} ${order.profile.first_name}`
        : "Ismeretlen vásárló";

    const county = order.profile?.county ?? "Megye nincs megadva";

    // ------------------------------------------------------------
    // Szerkesztés indítása
    // ------------------------------------------------------------
    const handleEdit = () => {
        setSaveError(null);
        setSaveSuccess(null);
        setEditedItems(initialItems);
        setIsEditing(true);
    };

    // ------------------------------------------------------------
    // Szerkesztés megszakítása
    // ------------------------------------------------------------
    const handleCancelEdit = () => {
        if (isSaving) {
            return;
        }

        setSaveError(null);
        setEditedItems([]);
        setIsEditing(false);
    };

    // ------------------------------------------------------------
    // Módosítás mentése
    // ------------------------------------------------------------
    const handleSave = async () => {
        if (!canSave || isSaving) {
            return;
        }

        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(null);

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
            p_order_id: order.id,
            p_items: rpcItems,
        });

        if (error) {
            setSaveError(
                error.message ||
                    "A rendelés módosítása sikertelen."
            );
            setIsSaving(false);
            return;
        }

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
        setEditedItems([]);

        router.refresh();
    };

    return (
        <div
            className={`
                overflow-hidden rounded-xl bg-white shadow-sm
                transition-all duration-200
                ${
                    isOpen
                        ? "border-2 border-blue-400 ring-2 ring-blue-100"
                        : "border border-gray-200"
                }
            `}
        >
            {/* -------------------------------------------------- */}
            {/* Rendelés fejléce                                   */}
            {/* -------------------------------------------------- */}
            <button
                type="button"
                onClick={onToggle}
                className="
                    w-full px-5 py-4 text-left
                    transition-colors hover:bg-gray-50/70
                "
                aria-expanded={isOpen}
            >
                <div className="flex items-center justify-between gap-6">
                    {/* Bal oldal */}
                    <div className="min-w-0 flex-1">
                        {/* Első sor */}
                        <div className="flex items-center gap-4">
                            <span className="shrink-0 font-semibold text-gray-800">
                                {order.public_order_number}
                            </span>

                            <span
                                className="
                                    shrink-0 rounded-md
                                    bg-gray-200
                                    px-2.5 py-1
                                    text-sm font-semibold
                                    text-gray-700
                                "
                            >
                                Átvétel: {pickupDate}
                            </span>
                        </div>

                        {/* Második sor */}
                        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-sm">
                            <span className="truncate font-medium text-gray-700">
                                {customerName}
                            </span>

                            <span className="shrink-0 text-gray-300">
                                •
                            </span>

                            <span className="truncate text-gray-500">
                                {county}
                            </span>

                            <span className="shrink-0 text-gray-300">
                                •
                            </span>

                            <span className="shrink-0 text-gray-400">
                                Utolsó módosítás: {lastModified}
                            </span>
                        </div>
                    </div>

                    {/* Jobb oldal */}
                    <div className="flex shrink-0 items-center gap-6">
                        <div className="text-right">
                            <div className="font-medium text-gray-700">
                                {totalQuantity} db csirke
                            </div>

                            <div className="text-sm text-gray-400">
                                {items.length} tétel
                            </div>
                        </div>

                        <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className={`
                                h-5 w-5 text-gray-400
                                transition-transform duration-200
                                ${isOpen ? "rotate-180" : ""}
                            `}
                            aria-hidden="true"
                        >
                            <path
                                fillRule="evenodd"
                                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                                clipRule="evenodd"
                            />
                        </svg>
                    </div>
                </div>
            </button>

            {/* -------------------------------------------------- */}
            {/* Lenyitott rendelés                                */}
            {/* -------------------------------------------------- */}
            {isOpen && (
                <div className="border-t border-gray-100 px-5 pb-5 pt-1">
                    {/* A mentett rendelés összefoglalója
                        szerkesztés közben is látható marad. */}
                    <AdminOrderItems items={items} />

                    {saveSuccess && !isEditing && (
                        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                            <p className="text-center text-sm text-[rgb(49,171,2)]">
                                {saveSuccess}
                            </p>
                        </div>
                    )}

                    {/* Normál admin műveletek */}
                    {!isEditing && (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
                            <button
                                type="button"
                                onClick={handleEdit}
                                className="
                                    rounded-lg border border-gray-300
                                    bg-white px-4 py-2
                                    text-sm font-medium text-gray-700
                                    transition
                                    hover:bg-gray-50
                                "
                            >
                                Módosítás
                            </button>

                            <button
                                type="button"
                                className="
                                    rounded-lg border border-gray-300
                                    bg-white px-4 py-2
                                    text-sm font-medium text-gray-700
                                    transition
                                    hover:bg-gray-50
                                "
                            >
                                Előzmények
                            </button>

                            <button
                                type="button"
                                className="
                                    rounded-lg border border-gray-300
                                    bg-white px-4 py-2
                                    text-sm font-medium text-gray-700
                                    transition
                                    hover:bg-gray-50
                                "
                            >
                                Felhasználó adatai
                            </button>

                            <button
                                type="button"
                                className="
                                    ml-auto rounded-lg border border-red-300
                                    bg-white px-4 py-2
                                    text-sm font-medium text-red-600
                                    transition
                                    hover:bg-red-50
                                "
                            >
                                Törlés
                            </button>
                        </div>
                    )}

                    {/* Szerkesztő */}
                    {isEditing && (
                        <div className="mt-4 border-t border-gray-200 pt-4">
                            <div
                                id={`order-edit-${order.id}`}
                                className="mb-4 w-full scroll-mt-24"
                            >
                                <h3 className="text-center font-semibold text-gray-800">
                                    Rendelés módosítása
                                </h3>

                                <div className="mt-2 flex items-center gap-2">
                                    <ArchiveBoxIcon
                                        className={`h-5 w-5 ${stockStatus.iconClass}`}
                                    />

                                    <p className="text-sm font-medium text-gray-700">
                                        {stockStatus.text}
                                    </p>
                                </div>
                            </div>

                            <ProductSelector
                                orderId={order.id}
                                products={products}
                                packages={packages}
                                maxAvailableQuantity={maxAvailableQuantity}
                                resetKey={0}
                                isPickupDaySelected={true}
                                initialItems={initialItems}
                                onOrderChangesChange={
                                    handleOrderChangesChange
                                }
                                onItemsChange={handleItemsChange}
                                onItemEdited={handleItemEdited}
                            />

                            {saveError && (
                                <p className="mt-4 text-sm text-red-600">
                                    {saveError}
                                </p>
                            )}

                            {/* Pont ugyanaz a Mentés / Mégse logika
                                és gombállapot, mint a History oldalon. */}
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
                                        ${
                                            canSave && !isSaving
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
                                    {isSaving
                                        ? "Mentés..."
                                        : "Módosítás mentése"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
