import "server-only";

import { formatOrderWindowEnd } from "@/lib/orderWindow";

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
    orderId: number;
    orderNumber: string;
    customerName: string;
    pickupDate: string;
    modificationWindowStart: string;
    modificationWindowEnd: string;
    items: OrderNotificationItem[];
};

export type OrderNotification = {
    subject: string;
    text: string;
    html: string;
};

export type OrderNotificationHtmlOptions = {
    logoSrc?: string;
    orderUrl?: string;
};

function formatPickupDate(value: string) {
    const dateOnly = value.split("T", 1)[0];
    const date = new Date(`${dateOnly}T12:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return dateOnly;
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

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function buildItemsHtml(items: OrderNotificationItem[]) {
    return items.map((item, index) => {
        const details = [
            `<span style="color:#6b7280;">Csomagolás:</span> ${escapeHtml(item.packageName)}`,
            item.sizePreference
                ? `<span style="color:#6b7280;">Méret:</span> ${escapeHtml(item.sizePreference)}`
                : null,
            item.note
                ? `<span style="color:#6b7280;">Megjegyzés:</span> ${escapeHtml(item.note)}`
                : null,
        ].filter(Boolean).join("<br>");

        return `
            <tr>
                <td style="padding:${index === 0 ? "6px" : "20px"} 0 20px;border-bottom:1px solid #e5e7eb;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                            <td style="padding-right:16px;vertical-align:top;">
                                <div style="font-size:14px;line-height:22px;font-weight:700;color:#374151;">
                                    ${escapeHtml(item.productName)}
                                </div>
                                <div style="padding-top:6px;font-size:14px;line-height:22px;color:#374151;">
                                    ${details}
                                </div>
                            </td>
                            <td width="74" style="vertical-align:top;text-align:right;white-space:nowrap;">
                                        <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#e9f9f1;color:#218856;font-size:14px;line-height:22px;font-weight:700;">
                                    ${item.quantity} db
                                </span>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`;
    }).join("");
}

function buildHtml(
    data: OrderNotificationData,
    heading: string,
    options: OrderNotificationHtmlOptions,
) {
    const logoSrc = escapeHtml(options.logoSrc ?? "cid:hejja-logo");
    const orderUrl = options.orderUrl ? escapeHtml(options.orderUrl) : null;
    const totalQuantity = data.items.reduce((sum, item) => sum + item.quantity, 0);

    return `<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f5;color:#374151;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
        ${escapeHtml(heading)} Rendelésszám: ${escapeHtml(data.orderNumber)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f5;">
        <tr>
            <td align="center" style="padding:28px 12px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(17,24,39,0.07);">
                    <tr>
                        <td style="padding:28px 34px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">
                            <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#4b5563;">
                                Kedves ${escapeHtml(data.customerName)}!
                            </p>

                            <div style="margin-bottom:20px;">
                                <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#46cc8d;color:#ffffff;font-size:14px;line-height:24px;text-align:center;font-weight:700;vertical-align:middle;">&#10003;</span>
                                <span style="padding-left:8px;font-size:14px;line-height:22px;font-weight:700;color:#374151;vertical-align:middle;">
                                    ${escapeHtml(heading)}
                                </span>
                            </div>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:26px;background:#f1fbf6;border-left:3px solid #46cc8d;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#374151;">
                                        <strong style="color:#218856;">Rendelésszám:</strong>
                                        ${escapeHtml(data.orderNumber)}<br>
                                        <strong style="color:#218856;">Átvétel napja:</strong>
                                        ${escapeHtml(formatPickupDate(data.pickupDate))}<br>
                                        <strong style="color:#218856;">Összes mennyiség:</strong>
                                        ${totalQuantity} db
                                    </td>
                                </tr>
                            </table>

                            <div style="margin-bottom:10px;text-align:center;font-size:14px;line-height:22px;font-weight:700;color:#374151;">
                                A rendelés tételei
                            </div>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                ${buildItemsHtml(data.items)}
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;margin-bottom:26px;background:#fff9e9;border-left:3px solid #e8b931;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#4b5563;">
                                        <strong style="color:#8a6514;">&#9998;&nbsp; A rendelés módosítható eddig:</strong><br>
                                        ${escapeHtml(formatOrderWindowEnd(data.modificationWindowEnd))}
                                    </td>
                                </tr>
                            </table>

                            ${orderUrl ? `
                            <div style="padding-top:28px;text-align:center;">
                                <a href="${orderUrl}" target="_blank" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#38b878;color:#ffffff;text-decoration:none;font-size:14px;line-height:22px;font-weight:700;">
                                    Rendelésem megtekintése
                                </a>
                            </div>` : ""}

                            <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;font-size:14px;line-height:22px;color:#6b7280;font-style:italic;">
                                &#9993;&nbsp; Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.<br>
                                Kérdés vagy probléma esetén írjon a
                                <a href="mailto:hejja-farm-csirke@gmail.com" style="color:#218856;font-weight:700;text-decoration:none;">hejja-farm-csirke@gmail.com</a>
                                címre.
                            </p>

                            <p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#6b7280;">
                                Üdvözlettel:
                            </p>

                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:12px;">
                                <tr>
                                    <td width="38" style="vertical-align:middle;">
                                        <img src="${logoSrc}" width="32" height="32" alt="Héjja Ökofarm" style="display:block;width:32px;height:32px;border:0;">
                                    </td>
                                    <td style="vertical-align:middle;font-size:14px;line-height:22px;font-weight:700;color:#4b5563;">
                                        Héjja Ökofarm
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export function buildOrderNotification(
    data: OrderNotificationData,
    htmlOptions: OrderNotificationHtmlOptions = {},
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
        `A rendelés módosítható eddig: ${formatOrderWindowEnd(data.modificationWindowEnd)}`,
        ...(htmlOptions.orderUrl
            ? ["", `Rendelés megtekintése: ${htmlOptions.orderUrl}`]
            : []),
        "",
        "Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.",
        "Kérdés vagy probléma esetén: hejja-farm-csirke@gmail.com",
        "",
        "Üdvözlettel:",
        "Héjja Ökofarm",
    ].join("\n");

    return {
        subject,
        text,
        html: buildHtml(data, heading, htmlOptions),
    };
}
