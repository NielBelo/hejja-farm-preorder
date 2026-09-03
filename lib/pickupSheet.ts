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

export type PickupSheetPickupDay = {
    pickup_date: string;
    planned_stock: number | null;
    available_stock: number | null;
};

export type PickupDateOption = {
    value: string;
    label: string;
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
    const dates = new Map<string, Pick<PickupDateOption, "plannedStock" | "availableStock">>();

    for (const pickupDay of pickupDays) {
        const value = normalizePickupDate(pickupDay.pickup_date);
        if (value && !dates.has(value)) {
            dates.set(value, {
                plannedStock: pickupDay.planned_stock ?? 0,
                availableStock: pickupDay.available_stock ?? 0,
            });
        }
    }

    return [...dates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([value, stock]) => ({
            value,
            label: formatPickupDate(value),
            ...stock,
        }));
}

export function getInitialPickupDate(dates: string[], today: string) {
    return dates.find((date) => date >= today) ?? dates.at(-1) ?? "";
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
