"use client";

import { useMemo, useState } from "react";
import { FunnelIcon, XMarkIcon } from "@heroicons/react/24/outline";
import OrderFilterDropdown from "@/components/admin/OrderFilterDropdown";
import { useOrderActionsManager } from "@/components/OrderActionsManager";
import { useCurrentBudapestDate } from "@/lib/usePickupDateStatus";
import { emptyFilters, filterLabels, getOrderFilterOptions, matchesOrderFilters, type FilterKey, type OrderFilters } from "@/lib/adminOrderFilters";
import AdminOrderCard, {
    type AdminOrder,
} from "@/components/admin/AdminOrderCard";

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

export default function AdminOrderList({
    orders,
    products,
    packages,
}: {
    orders: AdminOrder[];
    products: Product[];
    packages: PackageOption[];
}) {
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);
    const [filters, setFilters] = useState<OrderFilters>(emptyFilters);
    const { editingOrderId } = useOrderActionsManager();
    const today = useCurrentBudapestDate();
    const options = useMemo(() => getOrderFilterOptions(orders, today), [orders, today]);
    const filteredOrders = useMemo(() => orders.filter((order) => matchesOrderFilters(order, filters, today)), [orders, filters, today]);
    const selectionCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);

    const handleToggle = (orderId: number) => {
        setOpenOrderId((currentId) =>
            currentId === orderId ? null : orderId
        );
    };

    return (
        <div className="space-y-3">
            <section aria-label="Rendelések szűrése" className="relative mb-5 rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-100 to-zinc-50 p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                        <FunnelIcon aria-hidden="true" className="h-5 w-5 text-zinc-500" />
                        Rendelések szűrése
                        {selectionCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{selectionCount}</span>}
                    </h2>
                    <button type="button" disabled={selectionCount === 0 || editingOrderId !== null} onClick={() => setFilters(emptyFilters)}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:opacity-60">
                        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                        Szűrők törlése
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
                        <OrderFilterDropdown key={key} label={filterLabels[key]} options={options[key]} selected={filters[key]} disabled={editingOrderId !== null}
                            onChange={(values) => setFilters((current) => ({ ...current, [key]: values }))} />
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <p role="status" aria-live="polite"><span className="font-semibold text-zinc-700">{filteredOrders.length}</span> / {orders.length} rendelés</p>
                    <p>{editingOrderId !== null ? "A szűréshez előbb mentse vagy zárja be a módosítást." : "Egy szűrőben több lehetőség is kiválasztható."}</p>
                </div>
            </section>
            {filteredOrders.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-500">
                    Nincs a kiválasztott szűrőknek megfelelő rendelés.
                </div>
            )}
            {filteredOrders.map((order) => (
                <AdminOrderCard
                    key={order.id}
                    order={order}
                    products={products}
                    packages={packages}
                    isOpen={openOrderId === order.id}
                    onToggle={() => handleToggle(order.id)}
                />
            ))}
        </div>
    );
}
