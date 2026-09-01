import type { AdminOrder } from "@/components/admin/AdminOrderCard";

export const filterLabels = {
    name: "Név",
    county: "Megye",
    pickup: "Átvételi nap",
    product: "Termék",
    status: "Rendelés státusz",
};
export type FilterKey = keyof typeof filterLabels;
export type OrderFilters = Record<FilterKey, string[]>;
export type FilterOption = { value: string; label: string };
export const emptyFilters: OrderFilters = { name: [], county: [], pickup: [], product: [], status: [] };

const weekdayFormatter = new Intl.DateTimeFormat("hu-HU", { weekday: "long", timeZone: "UTC" });

function pickupCalendarDate(value: string) {
    // pickup_date may be a date or a local ISO timestamp; keep its calendar day.
    return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? value.slice(0, 10) : "";
}

function formatPickupOption(date: string) {
    if (!date) return "Nincs megadva";
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return "Nincs megadva";
    return `${date.replaceAll("-", ". ")}. – ${weekdayFormatter.format(parsed)}`;
}

export function getOrderFilterValues(order: AdminOrder, today: string): Record<FilterKey, string[]> {
    const pickup = pickupCalendarDate(order.pickup_days?.pickup_date ?? "");
    return {
        name: [order.user_id],
        county: [order.profile?.county?.trim() || "Nincs megadva"],
        pickup: [pickup],
        product: (order.order_versions?.order_items ?? []).map((item) => String(item.product_id)),
        status: [order.status === "cancelled" ? "cancelled" : !today || !pickup ? "unknown" : pickup < today ? "past" : "current"],
    };
}

export function matchesOrderFilters(order: AdminOrder, filters: OrderFilters, today: string) {
    const values = getOrderFilterValues(order, today);
    return (Object.keys(filters) as FilterKey[]).every((key) =>
        filters[key].length === 0 || filters[key].some((value) => values[key].includes(value))
    );
}

export function getOrderFilterOptions(orders: AdminOrder[], today: string): Record<FilterKey, FilterOption[]> {
    const options: Record<FilterKey, Map<string, string>> = {
        name: new Map(), county: new Map(), pickup: new Map(), product: new Map(), status: new Map(),
    };
    const statusLabels: Record<string, string> = { current: "Aktuális", past: "Teljesített", cancelled: "Lemondva", unknown: "Ismeretlen" };
    for (const order of orders) {
        const values = getOrderFilterValues(order, today);
        const name = [order.profile?.last_name, order.profile?.first_name].filter(Boolean).join(" ").trim();
        options.name.set(order.user_id, name || "Ismeretlen felhasználó");
        options.county.set(values.county[0], values.county[0]);
        const date = values.pickup[0];
        options.pickup.set(date, formatPickupOption(date));
        for (const item of order.order_versions?.order_items ?? []) {
            options.product.set(String(item.product_id), item.products?.name || "Ismeretlen termék");
        }
        options.status.set(values.status[0], statusLabels[values.status[0]]);
    }
    return Object.fromEntries((Object.keys(options) as FilterKey[]).map((key) => [
        key,
        [...options[key]].map(([value, label]) => ({ value, label })).sort((a, b) =>
            key === "pickup" ? a.value.localeCompare(b.value) : a.label.localeCompare(b.label, "hu")
        ),
    ])) as Record<FilterKey, FilterOption[]>;
}
