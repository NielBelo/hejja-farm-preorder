import "server-only";

import { getPickupWindowInfo } from "@/lib/pickupInfo";
import { isBacsKiskunCounty } from "@/lib/countyGroups";
import {
    buildItemsHtml,
    escapeHtml,
    formatItem,
    type OrderNotificationItem,
} from "@/lib/email/orderNotification";

// A Bács-Kiskun (DUNAVECSE) vásárlók sosem kapnak emlékeztetőt (lásd
// lib/email/reminderData.ts) - ezt itt, a sablon szintjén is kikényszerítjük,
// hogy egy esetleges hívási hiba se tudjon nekik hibás vagy értelmezhetetlen
// (helyszín/idő nélküli) emlékeztetőt előállítani.
export type ReminderEmailData = {
    orderId: number;
    orderNumber: string;
    customerName: string;
    pickupDate: string;
    pickupTimeStart: string | null;
    pickupTimeEnd: string | null;
    localPickupTimeStart: string | null;
    county: string | null;
    items: OrderNotificationItem[];
};

export type ReminderEmail = {
    subject: string;
    text: string;
    html: string;
};

export type ReminderEmailHtmlOptions = {
    logoSrc?: string;
    orderUrl?: string;
};

function buildHtml(data: ReminderEmailData, options: ReminderEmailHtmlOptions) {
    const logoSrc = escapeHtml(options.logoSrc ?? "cid:hejja-logo");
    const orderUrl = options.orderUrl ? escapeHtml(options.orderUrl) : null;
    const totalQuantity = data.items.reduce((sum, item) => sum + item.quantity, 0);
    const pickupWindow = getPickupWindowInfo({
        pickupDate: data.pickupDate,
        pickupTimeStart: data.pickupTimeStart,
        pickupTimeEnd: data.pickupTimeEnd,
        localPickupTimeStart: data.localPickupTimeStart,
        county: data.county,
    });
    const heading = "Szeretnénk emlékeztetni, hogy rendelését holnap veheti át.";

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
                <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(17,24,39,0.07);">
                    <tr>
                        <td style="padding:28px 34px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">
                            <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#4b5563;">
                                Kedves ${escapeHtml(data.customerName)}!
                            </p>

                            <div style="margin-bottom:20px;padding:14px 17px;background:#eff6ff;border-left:3px solid #60a5fa;border-radius:0 8px 8px 0;">
                                <span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#3b82f6;line-height:24px;text-align:center;vertical-align:middle;color:#ffffff;font-size:14px;font-weight:700;font-style:italic;font-family:Georgia,'Times New Roman',serif;">i</span>
                                <span style="padding-left:8px;font-size:14px;line-height:22px;font-weight:700;color:#1e40af;vertical-align:middle;">
                                    ${escapeHtml(heading)}
                                </span>
                            </div>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:26px;background:#f1fbf6;border-left:3px solid #46cc8d;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#374151;">
                                        <strong style="color:#218856;">Rendelésszám:</strong>
                                        ${escapeHtml(data.orderNumber)}<br>
                                        <strong style="color:#218856;">Átvétel időpontja:</strong>
                                        ${escapeHtml(pickupWindow.windowLabel)}<br>
                                        <strong style="color:#218856;">Átvétel helye:</strong>
                                        ${escapeHtml(pickupWindow.location)}<br>
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

                            ${orderUrl ? `
                            <div style="padding-top:28px;text-align:center;">
                                <a href="${orderUrl}" target="_blank" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#38b878;color:#ffffff;text-decoration:none;font-size:14px;line-height:22px;font-weight:700;">
                                    Rendelésem megtekintése
                                </a>
                            </div>` : ""}

                            <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;font-size:14px;line-height:22px;color:#6b7280;font-style:italic;">
                                &#9993;&nbsp; Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.<br>
                                Kérdés vagy probléma esetén írjon a
                                <a href="mailto:hejjaokofarm@gmail.com" style="color:#218856;font-weight:700;text-decoration:none;">hejjaokofarm@gmail.com</a>
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

export function buildReminderEmail(
    data: ReminderEmailData,
    htmlOptions: ReminderEmailHtmlOptions = {},
): ReminderEmail {
    if (isBacsKiskunCounty(data.county)) {
        throw new Error("Bács-Kiskun vármegyei (DUNAVECSE) vásárlónak nem küldhető emlékeztető e-mail.");
    }

    const pickupWindow = getPickupWindowInfo({
        pickupDate: data.pickupDate,
        pickupTimeStart: data.pickupTimeStart,
        pickupTimeEnd: data.pickupTimeEnd,
        localPickupTimeStart: data.localPickupTimeStart,
        county: data.county,
    });
    const subject = `Héjja Ökofarm – rendelés átvételi emlékeztető (${data.orderNumber})`;

    const text = [
        `Kedves ${data.customerName}!`,
        "",
        "Szeretnénk emlékeztetni, hogy rendelését holnap veheti át.",
        `Rendelésszám: ${data.orderNumber}`,
        `Átvétel időpontja: ${pickupWindow.windowLabel}`,
        `Átvétel helye: ${pickupWindow.location}`,
        "",
        "A rendelés tételei:",
        data.items.map(formatItem).join("\n\n"),
        ...(htmlOptions.orderUrl ? ["", `Rendelés megtekintése: ${htmlOptions.orderUrl}`] : []),
        "",
        "Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.",
        "Kérdés vagy probléma esetén: hejjaokofarm@gmail.com",
        "",
        "Üdvözlettel:",
        "Héjja Ökofarm",
    ].join("\n");

    return {
        subject,
        text,
        html: buildHtml(data, htmlOptions),
    };
}
