import type { AdminOrder } from "@/components/admin/AdminOrderCard";

export const filterLabels = {
    season: "Szezon",
    pickup: "Átvételi nap",
    county: "Megye",
    name: "Vásárló",
    status: "Rendelési státusz",
};
export type FilterKey = keyof typeof filterLabels;
export type OrderFilters = Record<FilterKey, string[]>;
export type FilterOption = { value: string; label: string };
export const emptyFilters: OrderFilters = { season: [], pickup: [], county: [], name: [], status: [] };

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

const seasonOrder: Record<string, number> = { tél: 0, tavasz: 1, nyár: 2, ősz: 3 };

export function getPickupSeason(year: number | null | undefined, season: string | null | undefined) {
    const normalized = season?.trim().toLocaleLowerCase("hu") ?? "";
    if (!Number.isInteger(year) || !normalized) {
        return { value: "", label: "Nincs megadva" };
    }
    const label = normalized.charAt(0).toLocaleUpperCase("hu") + normalized.slice(1);
    const order = seasonOrder[normalized] ?? 9;
    return { value: `${year}-${order}-${normalized}`, label: `${year} ${label}` };
}

export function getOrderFilterValues(order: AdminOrder, today: string): Record<FilterKey, string[]> {
    const pickup = pickupCalendarDate(order.pickup_days?.pickup_date ?? "");
    return {
        season: [getPickupSeason(order.pickup_days?.year, order.pickup_days?.season).value],
        pickup: [pickup],
        county: [order.profile?.county?.trim() || "Nincs megadva"],
        name: [order.user_id],
        status: [order.status === "cancelled" ? "cancelled" : !today || !pickup ? "unknown" : pickup < today ? "past" : "current"],
    };
}

export function getDefaultOrderFilters(orders: AdminOrder[]): OrderFilters {
    const latestSeason = orders
        .map((order) => getPickupSeason(order.pickup_days?.year, order.pickup_days?.season).value)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .at(-1);

    return {
        ...emptyFilters,
        season: latestSeason ? [latestSeason] : [],
        status: ["current"],
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
        season: new Map(), pickup: new Map(), county: new Map(), name: new Map(), status: new Map(),
    };
    const statusLabels: Record<string, string> = { current: "Aktuális", past: "Teljesített", cancelled: "Lemondva", unknown: "Ismeretlen" };
    for (const order of orders) {
        const values = getOrderFilterValues(order, today);
        const name = [order.profile?.last_name, order.profile?.first_name].filter(Boolean).join(" ").trim();
        options.name.set(order.user_id, name || "Ismeretlen felhasználó");
        options.county.set(values.county[0], values.county[0]);
        const date = values.pickup[0];
        const season = getPickupSeason(order.pickup_days?.year, order.pickup_days?.season);
        options.season.set(season.value, season.label);
        options.pickup.set(date, formatPickupOption(date));
        options.status.set(values.status[0], statusLabels[values.status[0]]);
    }
    return Object.fromEntries((Object.keys(options) as FilterKey[]).map((key) => [
        key,
        [...options[key]].map(([value, label]) => ({ value, label })).sort((a, b) =>
            key === "pickup" || key === "season" ? a.value.localeCompare(b.value) : a.label.localeCompare(b.label, "hu")
        ),
    ])) as Record<FilterKey, FilterOption[]>;
}
