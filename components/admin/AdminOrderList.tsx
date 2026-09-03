"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowPathIcon, FunnelIcon, XMarkIcon } from "@heroicons/react/24/outline";
import OrderFilterDropdown from "@/components/admin/OrderFilterDropdown";
import { useOrderActionsManager } from "@/components/OrderActionsManager";
import { useCurrentBudapestDate } from "@/lib/usePickupDateStatus";
import { emptyFilters, filterLabels, getDefaultOrderFilters, getOrderFilterOptions, matchesOrderFilters, type FilterKey, type OrderFilters } from "@/lib/adminOrderFilters";
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
    initialOrders,
    initialSeason,
    seasonOptions,
    products,
    packages,
}: {
    initialOrders: AdminOrder[];
    initialSeason: string;
    seasonOptions: { value: string; label: string }[];
    products: Product[];
    packages: PackageOption[];
}) {
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);
    const [filters, setFilters] = useState<OrderFilters>(() => getDefaultOrderFilters(initialSeason));
    const [orders, setOrders] = useState<AdminOrder[]>(initialOrders);
    const [isLoadingSeasons, setIsLoadingSeasons] = useState(false);
    const [seasonError, setSeasonError] = useState<string | null>(null);
    const orderCache = useRef(new Map<string, AdminOrder[]>(
        initialSeason ? [[initialSeason, initialOrders]] : []
    ));
    const pendingRequests = useRef(new Map<string, Promise<AdminOrder[]>>());
    const loadGeneration = useRef(0);
    const { editingOrderId } = useOrderActionsManager();
    const today = useCurrentBudapestDate();
    const options = useMemo(() => ({
        ...getOrderFilterOptions(orders, today),
        season: seasonOptions,
    }), [orders, seasonOptions, today]);
    const filtersForLoadedOrders = useMemo(() => ({ ...filters, season: [] }), [filters]);
    const filteredOrders = useMemo(
        () => orders.filter((order) => matchesOrderFilters(order, filtersForLoadedOrders, today)),
        [orders, filtersForLoadedOrders, today]
    );
    const selectionCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);

    const fetchSeason = useCallback(async (season: string, force = false) => {
        if (!force) {
            const cached = orderCache.current.get(season);
            if (cached) return cached;
        }

        const pending = pendingRequests.current.get(season);
        if (pending) return pending;

        const request = fetch(`/api/admin/orders?season=${encodeURIComponent(season)}`, {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        }).then(async (response) => {
            const body = await response.json().catch(() => null) as { orders?: AdminOrder[]; error?: string } | null;
            if (!response.ok || !body || !Array.isArray(body.orders)) {
                throw new Error(body?.error || (response.redirected
                    ? "A munkamenet lejárt. Jelentkezzen be újra."
                    : "A rendelések betöltése sikertelen."));
            }
            orderCache.current.set(season, body.orders);
            return body.orders;
        }).finally(() => {
            pendingRequests.current.delete(season);
        });

        pendingRequests.current.set(season, request);
        return request;
    }, []);

    const loadSeasons = useCallback(async (selectedSeasons: string[], force = false) => {
        const generation = ++loadGeneration.current;
        const targetSeasons = selectedSeasons.length > 0
            ? selectedSeasons
            : seasonOptions.map((option) => option.value);

        setIsLoadingSeasons(true);
        setSeasonError(null);

        try {
            const seasonOrders = await Promise.all(
                targetSeasons.map((season) => fetchSeason(season, force))
            );
            if (generation !== loadGeneration.current) return;

            const uniqueOrders = new Map<number, AdminOrder>();
            for (const order of seasonOrders.flat()) uniqueOrders.set(order.id, order);
            setOrders([...uniqueOrders.values()].sort((left, right) => (
                right.created_at.localeCompare(left.created_at)
            )));
        } catch (error) {
            if (generation !== loadGeneration.current) return;
            setSeasonError(error instanceof Error ? error.message : "A rendelések betöltése sikertelen.");
        } finally {
            if (generation === loadGeneration.current) setIsLoadingSeasons(false);
        }
    }, [fetchSeason, seasonOptions]);

    const handleFilterChange = (key: FilterKey, values: string[]) => {
        setFilters((current) => ({ ...current, [key]: values }));
        if (key === "season") void loadSeasons(values);
    };

    const handleClearFilters = () => {
        setFilters(emptyFilters);
        void loadSeasons([]);
    };

    const refreshLoadedSeasons = useCallback(async () => {
        await loadSeasons(filters.season, true);
    }, [filters.season, loadSeasons]);

    const handleToggle = (orderId: number) => {
        setOpenOrderId((currentId) =>
            currentId === orderId ? null : orderId
        );
    };

    return (
        <div className="space-y-3">
            <section aria-label="Rendelések szűrése" className="relative mb-5 rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-100 to-zinc-50 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                        <FunnelIcon aria-hidden="true" className="h-5 w-5 text-zinc-500" />
                        Rendelések szűrése
                        {selectionCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{selectionCount}</span>}
                    </h2>
                    <button type="button" disabled={selectionCount === 0 || editingOrderId !== null || isLoadingSeasons} onClick={handleClearFilters}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:opacity-60">
                        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                        Szűrők törlése
                    </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
                        <OrderFilterDropdown key={key} label={filterLabels[key]} options={options[key]} selected={filters[key]} disabled={editingOrderId !== null}
                            onChange={(values) => handleFilterChange(key, values)} />
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <p role="status" aria-live="polite"><span className="font-semibold text-zinc-700">{filteredOrders.length}</span> / {orders.length} rendelés</p>
                    <p className="flex items-center gap-1.5">
                        {isLoadingSeasons && <ArrowPathIcon aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
                        {editingOrderId !== null
                            ? "A szűréshez előbb mentse vagy zárja be a módosítást."
                            : isLoadingSeasons
                                ? "A kiválasztott szezon rendeléseinek betöltése…"
                                : "Egy szűrőben több lehetőség is kiválasztható."}
                    </p>
                </div>
            </section>
            {seasonError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {seasonError} A korábban betöltött lista maradt látható.
                    <button type="button" onClick={() => void loadSeasons(filters.season)} className="ml-2 font-semibold underline underline-offset-2">
                        Újrapróbálás
                    </button>
                </div>
            )}
            <div className={`space-y-3 transition-opacity ${isLoadingSeasons ? "opacity-50" : "opacity-100"}`} aria-busy={isLoadingSeasons}>
                {filteredOrders.length === 0 && !isLoadingSeasons && (
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
                        onOrderChanged={refreshLoadedSeasons}
                    />
                ))}
            </div>
        </div>
    );
}
