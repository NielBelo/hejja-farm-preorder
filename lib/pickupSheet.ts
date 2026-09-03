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
    customerName: string;
    phone: string;
    items: PickupSheetItem[];
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

export function getPickupDateOptions(orders: PickupSheetOrder[]) {
    return [...new Set(orders.map((order) => order.pickupDate).filter(Boolean))]
        .sort()
        .map((value) => ({ value, label: formatPickupDate(value) }));
}

export function getInitialPickupDate(dates: string[], today: string) {
    return dates.find((date) => date >= today) ?? dates.at(-1) ?? "";
}

export function summarizePickupOrders(orders: PickupSheetOrder[]) {
    return {
        customerCount: new Set(orders.map((order) => order.user_id)).size,
        itemCount: orders.reduce((total, order) => total + order.items.length, 0),
        chickenCount: orders.reduce(
            (total, order) => total + order.items.reduce((orderTotal, item) => orderTotal + item.quantity, 0),
            0
        ),
    };
}

export function formatPhoneNumber(phone: string) {
    return phone.replace(/^(\+36)(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4");
}

export function summarizePackage(name: string | null | undefined) {
    if (!name) return "—";
    const normalized = name.toLocaleLowerCase("hu");
    if (normalized.includes("gyűjt")) return "Gyűjtő";
    if (normalized.includes("egyedi")) return "Egyedi";
    return name.replace(/\s*csomagolás\s*/iu, "").trim() || name;
}

export function summarizeProduct(name: string | null | undefined) {
    if (!name) return "—";
    const normalized = name.toLocaleLowerCase("hu");
    if (normalized.includes("darab")) return "Darab";
    if (normalized.includes("egész")) return "Egész";
    return name;
}

export function summarizeSize(preference: string | null | undefined) {
    if (!preference) return "Átlagos";
    const normalized = preference.toLocaleLowerCase("hu");
    if (normalized.includes("kisebb")) return "Kisebb";
    if (normalized.includes("nagyobb")) return "Nagyobb";
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
