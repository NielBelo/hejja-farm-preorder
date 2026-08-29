"use client";

import AdminOrderItems from "@/components/admin/AdminOrderItems";

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
    // ------------------------------------------------------------
    // Aktuális rendelési tételek
    // ------------------------------------------------------------
    const items = order.order_versions?.order_items ?? [];

    const totalQuantity = items.reduce(
        (sum, item) => sum + item.quantity,
        0
    );

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
                    <AdminOrderItems items={items} />

                    {/* Admin műveletek */}
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
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
                </div>
            )}
        </div>
    );
}