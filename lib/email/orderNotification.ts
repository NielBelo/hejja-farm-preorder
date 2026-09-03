import "server-only";

export type OrderNotificationKind = "created" | "updated";

export type OrderNotificationItem = {
    productName: string;
    packageName: string;
    quantity: number;
    sizePreference: string | null;
    note: string | null;
};

export type OrderNotificationData = {
    kind: OrderNotificationKind;
    orderNumber: string;
    customerName: string;
    pickupDate: string;
    items: OrderNotificationItem[];
};

export type OrderNotification = {
    subject: string;
    text: string;
};

function formatPickupDate(value: string) {
    const date = new Date(`${value}T12:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return new Intl.DateTimeFormat("hu-HU", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Europe/Budapest",
    }).format(date);
}

function formatItem(item: OrderNotificationItem, index: number) {
    const lines = [
        `${index + 1}. ${item.productName} – ${item.quantity} db`,
        `   Csomagolás: ${item.packageName}`,
    ];

    if (item.sizePreference) {
        lines.push(`   Méret: ${item.sizePreference}`);
    }

    if (item.note) {
        lines.push(`   Megjegyzés: ${item.note}`);
    }

    return lines.join("\n");
}

export function buildOrderNotification(
    data: OrderNotificationData,
): OrderNotification {
    const isCreated = data.kind === "created";
    const subject = isCreated
        ? `Héjja-Farm – rendelés visszaigazolása (${data.orderNumber})`
        : `Héjja-Farm – rendelés módosítva (${data.orderNumber})`;
    const heading = isCreated
        ? "Rendelését sikeresen rögzítettük."
        : "Rendelésének módosítását sikeresen rögzítettük.";

    const text = [
        `Kedves ${data.customerName}!`,
        "",
        heading,
        `Rendelésszám: ${data.orderNumber}`,
        `Átvétel napja: ${formatPickupDate(data.pickupDate)}`,
        "",
        "A rendelés tételei:",
        data.items.map(formatItem).join("\n\n"),
        "",
        "Üdvözlettel:",
        "A Héjja-Farm csapata",
    ].join("\n");

    return { subject, text };
}
