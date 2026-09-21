import { getPickupSeason } from "@/lib/adminOrderFilters";
import { normalizeSizePreference } from "@/lib/sizePreferences";

export type PickupSheetItem = {
    id: number;
    quantity: number;
    size_preference: string | null;
    note: string | null;
    products: { name: string } | null;
    packages: { name: string } | null;
};

export type PickupSheetOrder = {
    id: number;
    public_order_number: string;
    user_id: string;
    pickupDate: string;
    // A DUNAVECSE (Bács-Kiskun) technikai nap ugyanazon a naptári napon van,
    // mint a szezon utolsó NORMÁL átvételi napja (lásd
    // supabase/migrations/20260921010000_bacskiskun_dunavecse.sql) - emiatt
    // a hozzá tartozó rendeléseket a puszta pickupDate nem tudja
    // megkülönböztetni a normál naptól, ehhez kell ez a mező is.
    pickupKind: "normal" | "dunavecse";
    // Két különböző szezon átvételi napjai elméletileg ugyanarra a naptári
    // dátumra eshetnek - lib/adminOrderFilters.ts getPickupSeason()
    // szezonazonosítója (lásd lib/adminOrderData.ts, ahol a szezonszűrés
    // már ma is ugyanezt a helpert használja) különbözteti meg őket, hogy
    // ilyenkor se keveredjenek össze.
    pickupSeasonValue: string;
    customerName: string;
    phone: string;
    items: PickupSheetItem[];
    specialSizePreference: "smaller" | "larger" | null;
};

export type PickupSheetPickupDay = {
    pickup_date: string;
    planned_stock: number | null;
    available_stock: number | null;
    kind?: string | null;
    year?: number | null;
    season?: string | null;
};

export type PickupDateOption = {
    value: string;
    label: string;
    // A visibleOrders szűréséhez (lásd PickupSheet.tsx) - a naptári nap, a
    // fajta (kind) és a szezon együtt azonosítja egyértelműen az átvételi
    // napot, mert a DUNAVECSE nap dátuma megegyezhet egy normál nap
    // dátumával, és (elvben) két különböző szezon is tartalmazhat azonos
    // dátumú napot.
    date: string;
    kind: "normal" | "dunavecse";
    seasonValue: string;
    plannedStock: number;
    availableStock: number;
};

export function normalizePickupDate(value: string) {
    return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? value.slice(0, 10) : "";
}

const pickupDateFormatter = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
});

export function formatPickupDate(value: string) {
    const normalized = normalizePickupDate(value);
    if (!normalized) return "Ismeretlen átvételi nap";
    return pickupDateFormatter.format(new Date(`${normalized}T00:00:00Z`));
}

export function sortPickupOrders(orders: PickupSheetOrder[]) {
    return [...orders].sort((left, right) => {
        const byName = left.customerName.localeCompare(right.customerName, "hu", {
            sensitivity: "base",
        });
        return byName || left.public_order_number.localeCompare(
            right.public_order_number,
            "hu",
            { numeric: true, sensitivity: "base" }
        );
    });
}

export function getPickupDateOptions(pickupDays: PickupSheetPickupDay[]) {
    // A "value" szándékosan nem maga a dátum, hanem a szezon és a fajta
    // (kind) is részt vesz benne - lásd a PickupDateOption.date kommentjét
    // arról, hogy ugyanaz a dátum elvben több szezonhoz/fajtához is
    // tartozhat.
    const options = new Map<string, PickupDateOption>();

    for (const pickupDay of pickupDays) {
        const date = normalizePickupDate(pickupDay.pickup_date);
        if (!date) continue;

        const kind: PickupDateOption["kind"] = pickupDay.kind === "dunavecse" ? "dunavecse" : "normal";
        const seasonValue = getPickupSeason(pickupDay.year, pickupDay.season).value;
        const value = kind === "dunavecse" ? `${seasonValue}:dunavecse:${date}` : `${seasonValue}:${date}`;
        if (options.has(value)) continue;

        options.set(value, {
            value,
            date,
            kind,
            seasonValue,
            label: kind === "dunavecse"
                ? `${formatPickupDate(date)} – DUNAVECSE (Bács-Kiskun)`
                : formatPickupDate(date),
            plannedStock: pickupDay.planned_stock ?? 0,
            availableStock: pickupDay.available_stock ?? 0,
        });
    }

    return [...options.values()].sort((left, right) => (
        left.date.localeCompare(right.date)
        || (left.kind === right.kind ? 0 : left.kind === "normal" ? -1 : 1)
    ));
}

// A `dates` bemenet a getPickupDateOptions() már dátum szerint rendezett
// kimenete. A cél dátum (a legközelebbi jövőbeli, vagy ennek hiányában a
// legutolsó múltbeli) meghatározása után, ha arra a napra normál ÉS
// DUNAVECSE opció is tartozik, mindig a normál napot választjuk
// alapértelmezettként - a DUNAVECSE technikai napot az adminnak
// tudatosan, kézzel kell kiválasztania.
export function getInitialPickupDate(
    dates: Pick<PickupDateOption, "value" | "date" | "kind">[],
    today: string
) {
    const targetDate = dates.find((date) => date.date >= today)?.date ?? dates.at(-1)?.date;
    if (targetDate === undefined) return "";

    const candidates = dates.filter((date) => date.date === targetDate);
    return (candidates.find((date) => date.kind === "normal") ?? candidates[0]).value;
}

export function summarizePickupOrders(orders: PickupSheetOrder[]) {
    return {
        customerCount: new Set(orders.map((order) => order.user_id)).size,
        orderCount: new Set(orders.map((order) => order.id)).size,
        itemCount: orders.reduce((total, order) => total + order.items.length, 0),
        chickenCount: orders.reduce(
            (total, order) => total + order.items.reduce((orderTotal, item) => orderTotal + item.quantity, 0),
            0
        ),
    };
}

export function summarizePickupStock(plannedStock: number, availableStock: number) {
    const capacity = Math.max(0, plannedStock);
    const availableCount = Math.min(capacity, Math.max(0, availableStock));
    const usedCount = capacity - availableCount;

    return {
        capacity,
        usedCount,
        availableCount,
        usedPercentage: capacity > 0 ? (usedCount / capacity) * 100 : 0,
        availablePercentage: capacity > 0 ? (availableCount / capacity) * 100 : 0,
    };
}

export function formatPhoneNumber(phone: string) {
    return phone.replace(/^(\+36)(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4");
}

// A csomagolástípus megjelenítendő neve mindig az adatbázisban tárolt
// aktuális packages.name-ből származik - nincs csomagolásnév-specifikus
// hardcode-olt leképezés, csak az ismétlődő "csomagolás" szó levágása a
// kompakt statisztikai kártyán, hogy egy átnevezés is automatikusan
// megjelenjen további kódmódosítás nélkül.
export function summarizePackage(name: string | null | undefined) {
    if (!name) return "—";
    return name.replace(/\s*csomagolás\s*/iu, "").trim() || name;
}

export function summarizePrintPackage(name: string | null | undefined) {
    if (!name) return "";
    const normalized = name.toLocaleLowerCase("hu");
    return normalized.includes("gyűjt") ? "Gyűjtő" : "";
}

export function summarizeProduct(name: string | null | undefined) {
    if (!name) return "—";
    const normalized = name.toLocaleLowerCase("hu");
    if (normalized.includes("darab")) return "Darab";
    if (normalized.includes("egész")) return "Egész";
    return name;
}

export function summarizeSize(preference: string | null | undefined) {
    const normalized = normalizeSizePreference(preference);
    if (normalized === "Átlagostól kisebb méret") return "Kisebb";
    if (normalized === "Átlagostól nagyobb méret") return "Nagyobb";
    return "Átlagos";
}

export type PickupDistributionEntry = {
    label: string;
    quantity: number;
    percentage: number;
};

function buildPickupDistribution(
    orders: PickupSheetOrder[],
    getLabel: (item: PickupSheetItem) => string
): PickupDistributionEntry[] {
    const quantities = new Map<string, number>();

    for (const order of orders) {
        for (const item of order.items) {
            const label = getLabel(item);
            quantities.set(label, (quantities.get(label) ?? 0) + item.quantity);
        }
    }

    const total = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0);

    return [...quantities.entries()]
        .map(([label, quantity]) => ({
            label,
            quantity,
            percentage: total > 0 ? (quantity / total) * 100 : 0,
        }))
        .sort((left, right) => (
            right.quantity - left.quantity
            || left.label.localeCompare(right.label, "hu", { sensitivity: "base" })
        ));
}

export function getPickupDistributions(orders: PickupSheetOrder[]) {
    return {
        products: buildPickupDistribution(
            orders,
            (item) => summarizeProduct(item.products?.name)
        ),
        packages: buildPickupDistribution(
            orders,
            (item) => summarizePackage(item.packages?.name)
        ),
        sizes: buildPickupDistribution(
            orders,
            (item) => summarizeSize(item.size_preference)
        ),
    };
}

export type CustomerSizePreferenceStat = {
    total: number;
    whole: number;
    chopped: number;
};

// A vásárló admin oldalon beállított "Nagyobb/Kisebb méret preferáció"
// (profiles.special_size_preference) alapján csoportosítja a TELJES
// rendeléseket - a rendelési tételek saját size_preference mezője itt
// szándékosan figyelmen kívül marad.
export function summarizeCustomerSizePreferenceGroups(orders: PickupSheetOrder[]) {
    const makeStat = (): CustomerSizePreferenceStat => ({ total: 0, whole: 0, chopped: 0 });
    const groups = { larger: makeStat(), smaller: makeStat() };

    for (const order of orders) {
        const preference = order.specialSizePreference;
        if (preference !== "larger" && preference !== "smaller") continue;

        const stat = groups[preference];
        for (const item of order.items) {
            stat.total += item.quantity;
            const product = summarizeProduct(item.products?.name);
            if (product === "Egész") stat.whole += item.quantity;
            else if (product === "Darab") stat.chopped += item.quantity;
        }
    }

    return groups;
}
