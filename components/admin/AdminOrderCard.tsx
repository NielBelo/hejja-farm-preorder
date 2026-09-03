"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { ArchiveBoxIcon, TrashIcon } from "@heroicons/react/24/outline";

import AdminOrderItems from "@/components/admin/AdminOrderItems";
import AdminCustomerDetails from "@/components/admin/AdminCustomerDetails";
import AdminCancelOrder from "@/components/admin/AdminCancelOrder";
import AdminRestoreOrder from "@/components/admin/AdminRestoreOrder";
import PickupDateStatus from "@/components/admin/PickupDateStatus";
import ProductSelector from "@/components/ProductSelector";
import { createClient } from "@/lib/supabase/client";
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
    size_preference: string | null;
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

type AdminOrderHistoryVersion = {
    id: number;
    version_number: number;
    created_at: string;
    created_by: string | null;
    order_items: AdminOrderItem[];
    modifiedByName: string;
};

type AdminPickupDay = {
    id: number;
    year: number;
    season: string | null;
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
    cancelled_by: string | null;
    cancelledByName?: string | null;
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
    onOrderChanged,
}: {
    order: AdminOrder;
    products: Product[];
    packages: PackageOption[];
    isOpen: boolean;
    onToggle: () => void;
    onOrderChanged: () => Promise<void>;
}) {
    const supabase = createClient();

    const [isEditing, setIsEditing] = useState(false);

    const {
        editingOrderId,
        startEditing,
        stopEditing,
    } = useOrderActionsManager();

    const anotherOrderIsEditing =
        editingOrderId !== null &&
        editingOrderId !== order.id;
    const isCancelled = order.status === "cancelled";
    const cannotModifyOrder = anotherOrderIsEditing || isCancelled;

    const [editedItems, setEditedItems] =
        useState<EditedOrderItem[]>([]);

    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] =
        useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] =
        useState<string | null>(null);

    // ------------------------------------------------------------
    // Előzmények
    // ------------------------------------------------------------
    const [isHistoryOpen, setIsHistoryOpen] =
        useState(false);
    const [isUserDetailsOpen, setIsUserDetailsOpen] = useState(false);

    const [historyVersions, setHistoryVersions] =
        useState<AdminOrderHistoryVersion[]>([]);

    const [isHistoryLoading, setIsHistoryLoading] =
        useState(false);

    const [historyError, setHistoryError] =
        useState<string | null>(null);

    // ------------------------------------------------------------
    // Ha a rendeléskártya bezáródik,
    // az előzmény nézet is alaphelyzetbe kerül
    // ------------------------------------------------------------
    useEffect(() => {
        if (!isOpen) {
            setIsUserDetailsOpen(false);
            setIsHistoryOpen(false);
            setHistoryVersions([]);
            setHistoryError(null);
            setIsHistoryLoading(false);
        }
    }, [isOpen]);

    // ------------------------------------------------------------
    // Aktuális rendelési tételek
    // ------------------------------------------------------------
    const items =
        order.order_versions?.order_items ?? [];

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
                    item.size_preference ??
                    "Átlagos méret megfelelő",
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
                selectedNote:
                    "Átlagos méret megfelelő",
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
        order.pickup_days.available_stock +
        originalQuantity;

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
                    iconClass:
                        "text-[rgb(49,171,2)]",
                };

    // ------------------------------------------------------------
    // Érintetlen üres "Új tétel"
    // ------------------------------------------------------------
    const isUntouchedEmptyItem = (
        item: EditedOrderItem
    ) =>
        item.selectedProductId === null &&
        item.selectedPackageId === null &&
        item.quantity === 1 &&
        item.note === "" &&
        item.selectedNote ===
        "Átlagos méret megfelelő" &&
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
                originalItem.product_id !==
                editedItem.selectedProductId ||
                originalItem.package_id !==
                editedItem.selectedPackageId ||
                originalItem.quantity !==
                editedItem.quantity ||
                (originalItem.note ?? "") !==
                editedItem.note ||
                (originalItem.size_preference ??
                    "Átlagos méret megfelelő") !==
                editedItem.selectedNote
            );
        });

    // ------------------------------------------------------------
    // Mentési feltétel
    // ------------------------------------------------------------
    const canSave =
        !isCancelled &&
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
        (_hasChanges: boolean) => { },
        []
    );

    const handleItemsChange = useCallback(
        (newItems: EditedOrderItem[]) => {
            setEditedItems(newItems);
        },
        []
    );

    const handleItemEdited =
        useCallback(() => { }, []);

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
    // Dátum + idő formázás
    // ------------------------------------------------------------
    const formatDateTime = (value: string) =>
        new Date(value).toLocaleString("hu-HU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });

    // ------------------------------------------------------------
    // Utolsó módosítás
    // ------------------------------------------------------------
    const lastModified = formatDateTime(
        order.order_versions.created_at
    );

    // ------------------------------------------------------------
    // Vásárló
    // ------------------------------------------------------------
    const customerName = order.profile
        ? `${order.profile.last_name} ${order.profile.first_name}`
        : "Ismeretlen vásárló";

    const county =
        order.profile?.county ??
        "Megye nincs megadva";

    // ------------------------------------------------------------
    // Előzmények megnyitása
    //
    // Minden megnyitáskor FRISSEN lekérjük:
    // - az aktuális verzió kivételével minden korábbi verziót
    // - legújabb verziótól a legrégebbi felé
    // - az akkori rendelési tételekkel
    // - a módosító nevével
    // ------------------------------------------------------------
    const handleOpenHistory = async () => {
        setIsUserDetailsOpen(false);
        setIsHistoryOpen(true);
        setIsHistoryLoading(true);
        setHistoryVersions([]);
        setHistoryError(null);

        const {
            data: versionData,
            error: versionError,
        } = await supabase
            .from("order_versions")
            .select(`
                id,
                version_number,
                created_at,
                created_by,

                order_items (
                    id,
                    product_id,
                    package_id,
                    quantity,
                    size_preference,
                    note,

                    products (
                        id,
                        name
                    ),

                    packages (
                        id,
                        name
                    )
                )
            `)
            .eq("order_id", order.id)
            .neq("id", order.current_version_id)
            .order("version_number", {
                ascending: false,
            });

        if (versionError) {
            setHistoryError(
                versionError.message ||
                "Az előzmények lekérése sikertelen."
            );
            setIsHistoryLoading(false);
            return;
        }

        type HistoryVersionRow = Omit<
            AdminOrderHistoryVersion,
            "modifiedByName"
        >;

        const rawVersions =
            (versionData ??
                []) as unknown as HistoryVersionRow[];

        // --------------------------------------------------------
        // A verziókat létrehozó / módosító felhasználók
        // --------------------------------------------------------
        const createdByIds = [
            ...new Set(
                rawVersions
                    .map(
                        (version) =>
                            version.created_by
                    )
                    .filter(
                        (
                            id
                        ): id is string =>
                            id !== null
                    )
            ),
        ];

        const modifierNameMap =
            new Map<string, string>();

        if (createdByIds.length > 0) {
            const {
                data: profileData,
            } = await supabase
                .from("profiles")
                .select(`
                    id,
                    first_name,
                    last_name
                `)
                .in("id", createdByIds);

            for (const profile of profileData ?? []) {
                modifierNameMap.set(
                    profile.id,
                    `${profile.last_name} ${profile.first_name}`
                );
            }
        }

        const versionsWithNames =
            rawVersions.map((version) => ({
                ...version,
                modifiedByName:
                    version.created_by
                        ? modifierNameMap.get(
                            version.created_by
                        ) ??
                        "Ismeretlen felhasználó"
                        : "Ismeretlen felhasználó",
            }));

        setHistoryVersions(versionsWithNames);
        setIsHistoryLoading(false);
    };

    // ------------------------------------------------------------
    // Előzmények bezárása
    // ------------------------------------------------------------
    const handleCloseHistory = () => {
        setIsHistoryOpen(false);
        setHistoryVersions([]);
        setHistoryError(null);
        setIsHistoryLoading(false);
    };

    // ------------------------------------------------------------
    // Szerkesztés indítása
    // ------------------------------------------------------------
    const handleEdit = () => {
        if (cannotModifyOrder) {
            return;
        }

        // Ha nyitva van az előzmény,
        // automatikusan bezárjuk.
        handleCloseHistory();

        setIsUserDetailsOpen(false);
        setSaveError(null);
        setSaveSuccess(null);
        setEditedItems(initialItems);

        startEditing(order.id);
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

        stopEditing();
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

        const rpcItems = itemsToSave.map(
            (item) => ({
                product_id:
                    item.selectedProductId,
                package_id:
                    item.selectedPackageId,
                quantity: item.quantity,
                size_preference:
                    item.selectedNote,
                note: item.note,
            })
        );

        const { error } = await supabase.rpc(
            "update_order",
            {
                p_order_id: order.id,
                p_items: rpcItems,
            }
        );

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

        stopEditing();

        await onOrderChanged();

        requestAnimationFrame(() => {
            document
                .getElementById(
                    `admin-order-${order.id}`
                )
                ?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
        });
    };

    return (
        <div
            className={`
                overflow-hidden rounded-xl bg-white shadow-sm
                transition-all duration-200
                ${isOpen
                    ? "border-2 border-blue-400 ring-2 ring-blue-100"
                    : "border border-gray-200"
                }
            `}
        >
            {/* -------------------------------------------------- */}
            {/* Rendelés fejléce                                   */}
            {/* -------------------------------------------------- */}
            <button
                id={`admin-order-${order.id}`}
                type="button"
                onClick={() => {
                    if (
                        editingOrderId !== null
                    ) {
                        return;
                    }

                    onToggle();
                }}
                className="
                    w-full scroll-mt-24 px-5 py-4 text-left
                    transition-colors hover:bg-gray-50/70
                "
                aria-expanded={isOpen}
            >
                <div className="flex items-center justify-between gap-6">
                    {/* Bal oldal */}
                    <div className="min-w-0 flex-1">
                        {/* Első sor */}
                        <div className="flex flex-wrap items-center gap-4">
                            <span className="shrink-0 font-semibold text-gray-800">
                                {
                                    order.public_order_number
                                }
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
                                Átvétel:{" "}
                                {pickupDate}
                            </span>
                            <PickupDateStatus
                                pickupDate={order.pickup_days.pickup_date}
                                orderStatus={order.status}
                            />
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
                                Utolsó módosítás:{" "}
                                {lastModified}
                            </span>
                        </div>
                    </div>

                    {/* Jobb oldal */}
                    <div className="flex shrink-0 items-center gap-6">
                        <div className="text-right">
                            <div className="font-medium text-gray-700">
                                {totalQuantity} db
                                csirke
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
                                ${isOpen
                                    ? "rotate-180"
                                    : ""
                                }
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
                    {/* Aktuális rendelés összefoglalója */}
                    <AdminOrderItems
                        items={items}
                    />

                    {saveSuccess &&
                        !isEditing && (
                            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                                <p className="text-center text-sm text-[rgb(49,171,2)]">
                                    {
                                        saveSuccess
                                    }
                                </p>
                            </div>
                        )}

                    {/* Normál admin műveletek */}
                    {!isEditing && (
                        <div className={`mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 ${isCancelled ? "pt-2.5" : "pt-4"}`}>
                            {isCancelled && (
                                <p className="mb-3 flex w-full min-w-0 items-start gap-1.5 text-sm text-gray-600">
                                    <TrashIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span className="min-w-0 break-words">
                                        Lemondta: {order.cancelledByName || "Ismeretlen felhasználó"}
                                    </span>
                                </p>
                            )}
                            {isCancelled ? (
                                <AdminRestoreOrder
                                    orderId={order.id}
                                    pickupDate={order.pickup_days.pickup_date}
                                    disabled={anotherOrderIsEditing}
                                    onOrderChanged={onOrderChanged}
                                />
                            ) : <button
                                type="button"
                                onClick={handleEdit}
                                disabled={
                                    cannotModifyOrder
                                }
                                className={`
                                    rounded-lg border border-gray-300
                                    bg-white px-4 py-2
                                    text-sm font-medium
                                    transition
                                    ${cannotModifyOrder
                                        ? "cursor-not-allowed bg-gray-100 text-gray-300"
                                        : "text-gray-700 hover:bg-gray-50"
                                    }
                                `}
                            >
                                Módosítás
                            </button>}

                            {!isHistoryOpen ? (
                                <button
                                    type="button"
                                    onClick={
                                        handleOpenHistory
                                    }
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
                            ) : (
                                <button
                                    type="button"
                                    onClick={
                                        handleCloseHistory
                                    }
                                    className="
                                        rounded-lg border border-gray-300
                                        bg-white px-4 py-2
                                        text-sm font-medium text-gray-700
                                        transition
                                        hover:bg-gray-50
                                    "
                                >
                                    Előzmények bezárása
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => {
                                    handleCloseHistory();
                                    setIsUserDetailsOpen((open) => !open);
                                }}
                                aria-expanded={isUserDetailsOpen}
                                aria-controls={`customer-details-${order.id}`}
                                className="
                                    rounded-lg border border-gray-300
                                    bg-white px-4 py-2
                                    text-sm font-medium text-gray-700
                                    transition
                                    hover:bg-gray-50
                                "
                            >
                                {isUserDetailsOpen ? "Felhasználói adatok bezárása" : "Felhasználó adatai"}
                            </button>

                            <AdminCancelOrder
                                key={`${order.id}-${order.status}`}
                                orderId={order.id}
                                publicOrderNumber={order.public_order_number}
                                pickupDate={order.pickup_days.pickup_date}
                                disabled={cannotModifyOrder}
                                onOrderChanged={onOrderChanged}
                                onOpen={() => {
                                    handleCloseHistory();
                                    setIsUserDetailsOpen(false);
                                }}
                            />
                        </div>
                    )}

                    {/* -------------------------------------------------- */}
                    {/* Rendelés előzményei                               */}
                    {/* -------------------------------------------------- */}
                    {isUserDetailsOpen && !isEditing && (
                        <AdminCustomerDetails order={order} id={`customer-details-${order.id}`} />
                    )}

                    {isHistoryOpen &&
                        !isEditing && (
                            <div className="mt-4 border-t border-gray-200 pt-4">
                                <h3 className="text-center font-semibold text-gray-800">
                                    Rendelés
                                    előzményei
                                </h3>

                                {historyError && (
                                    <p className="mt-4 text-center text-sm text-red-600">
                                        {
                                            historyError
                                        }
                                    </p>
                                )}

                                {!isHistoryLoading &&
                                    !historyError &&
                                    historyVersions.length ===
                                    0 && (
                                        <p className="mt-4 text-center text-sm text-gray-500">
                                            Nincs korábbi
                                            verzió.
                                        </p>
                                    )}

                                {!isHistoryLoading &&
                                    !historyError &&
                                    historyVersions.length >
                                    0 && (
                                        <ol aria-label="Rendelés verzióelőzményei, a legújabbtól a legrégebbiig" className="mt-3">
                                            {historyVersions.map(
                                                (
                                                    version,
                                                    index
                                                ) => (
                                                    <li
                                                        key={
                                                            version.id
                                                        }
                                                        className="relative pl-5 pb-3 last:pb-0"
                                                    >
                                                        {index < historyVersions.length - 1 && (
                                                            <span
                                                                aria-hidden="true"
                                                                className="absolute left-1 top-4 -bottom-4 w-0.5 bg-violet-600"
                                                            />
                                                        )}
                                                        <span
                                                            aria-hidden="true"
                                                            className="absolute left-0 top-[11px] z-10 h-2.5 w-2.5 rounded-full border-2 border-violet-600 bg-white"
                                                        />
                                                        <span
                                                            aria-hidden="true"
                                                            className="absolute left-2.5 top-[15px] h-0.5 w-2.5 bg-violet-600"
                                                        />
                                                        <div className="mb-1.5 flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
                                                            <span
                                                                className="shrink-0 rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800"
                                                            >
                                                                {version.version_number}. verzió
                                                            </span>

                                                            <time dateTime={version.created_at}>
                                                                {formatDateTime(
                                                                    version.created_at
                                                                )}
                                                            </time>

                                                            <span className="min-w-0 break-words text-gray-600 sm:ml-auto">
                                                                {
                                                                    version.modifiedByName
                                                                }
                                                            </span>
                                                        </div>

                                                        <AdminOrderItems
                                                            compact
                                                            items={
                                                                version.order_items ??
                                                                []
                                                            }
                                                        />
                                                    </li>
                                                )
                                            )}
                                        </ol>
                                    )}
                            </div>
                        )}

                    {/* -------------------------------------------------- */}
                    {/* Szerkesztő                                        */}
                    {/* -------------------------------------------------- */}
                    {isEditing && (
                        <div className="mt-4 border-t border-gray-200 pt-4">
                            <div
                                id={`order-edit-${order.id}`}
                                className="mb-4 w-full scroll-mt-24"
                            >
                                <h3 className="text-center font-semibold text-gray-800">
                                    Rendelés
                                    módosítása
                                </h3>

                                <div className="mt-2 flex items-center gap-2">
                                    <ArchiveBoxIcon
                                        className={`h-5 w-5 ${stockStatus.iconClass}`}
                                    />

                                    <p className="text-sm font-medium text-gray-700">
                                        {
                                            stockStatus.text
                                        }
                                    </p>
                                </div>
                            </div>

                            <ProductSelector
                                orderId={
                                    order.id
                                }
                                products={
                                    products
                                }
                                packages={
                                    packages
                                }
                                maxAvailableQuantity={
                                    maxAvailableQuantity
                                }
                                resetKey={0}
                                isPickupDaySelected={
                                    true
                                }
                                initialItems={
                                    initialItems
                                }
                                onOrderChangesChange={
                                    handleOrderChangesChange
                                }
                                onItemsChange={
                                    handleItemsChange
                                }
                                onItemEdited={
                                    handleItemEdited
                                }
                            />

                            {saveError && (
                                <p className="mt-4 text-sm text-red-600">
                                    {saveError}
                                </p>
                            )}

                            <div className="mt-5 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={
                                        handleCancelEdit
                                    }
                                    disabled={
                                        isSaving
                                    }
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
                                    onClick={
                                        handleSave
                                    }
                                    disabled={
                                        !canSave ||
                                        isSaving
                                    }
                                    className={`
                                        rounded-lg px-5 py-2
                                        text-sm font-medium
                                        transition-colors
                                        ${canSave &&
                                            !isSaving
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
