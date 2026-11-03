import "server-only";

import { escapeHtml } from "@/lib/email/orderNotification";

// A szezonindítási értesítő sablonja. A szezon adatai (év, évszak, az
// előrendelési időszak kezdete és vége) a season_parameters táblából
// érkeznek (year, season, time_window_start, time_window_end) - semmi nincs
// beégetve. Egyelőre csak az admin előnézet használja, küldés nincs.
export type SeasonLaunchData = {
    year: number;
    /** A season_parameters.season értéke: "Tavasz" vagy "Ősz". */
    season: string;
    /** ISO időbélyeg: az előrendelési időszak kezdete. */
    orderStart: string;
    /** ISO időbélyeg: az előrendelési időszak vége. */
    orderEnd: string;
};

export type SeasonLaunchEmail = {
    subject: string;
    text: string;
    html: string;
};

export type SeasonLaunchEmailOptions = {
    logoSrc?: string;
    orderUrl?: string;
};

const DEFAULT_ORDER_URL = "https://hejja-okofarm.hu/preorder";

const SEASON_ADJECTIVES: Record<string, string> = {
    tavasz: "tavaszi",
    ősz: "őszi",
    nyár: "nyári",
    tél: "téli",
};

// A magyar évszám-melléknév (-as/-es/-os/-ös) az évszám kiejtett utolsó
// tagjától függ: 2026-os, 2027-es, 2030-as, 2025-ös.
function yearSuffix(year: number) {
    const lastDigit = year % 10;
    if (lastDigit === 0) {
        const tens = Math.floor(year / 10) % 10;
        if ([0, 1, 4, 7, 9].includes(tens)) return "es";
        return tens === 5 ? "ös" : tens === 6 ? "os" : "as";
    }
    return ["", "es", "es", "as", "es", "ös", "os", "es", "as", "es"][lastDigit];
}

export function formatSeasonLabel(year: number, season: string) {
    const normalized = season.trim().toLowerCase();
    const adjective = SEASON_ADJECTIVES[normalized] ?? normalized;
    return `${year}-${yearSuffix(year)} ${adjective} szezon`;
}

function formatDateTime(value: string) {
    return new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Europe/Budapest",
    }).format(new Date(value));
}

function buildHtml(data: SeasonLaunchData, subject: string, options: SeasonLaunchEmailOptions) {
    const logoSrc = escapeHtml(options.logoSrc ?? "cid:hejja-logo");
    const orderUrl = escapeHtml(options.orderUrl ?? DEFAULT_ORDER_URL);
    const seasonLabel = formatSeasonLabel(data.year, data.season);
    const seasonLabelInflected = `${seasonLabel}jára`;

    return `<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f5;color:#374151;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
        ${escapeHtml(subject)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f5;">
        <tr>
            <td align="center" style="padding:28px 12px;">
                <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(17,24,39,0.07);">
                    <tr>
                        <td style="padding:28px 34px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">
                            <p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#4b5563;">
                                Kedves Vásárlónk!
                            </p>

                            <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#4b5563;">
                                A Héjja Ökofarm <strong>${escapeHtml(seasonLabelInflected)}</strong> hamarosan megnyílik az előrendelési lehetőség.
                            </p>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:26px;background:#f1fbf6;border-left:3px solid #46cc8d;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#374151;">
                                        <strong style="color:#218856;">${escapeHtml(seasonLabel)}</strong><br>
                                        <strong style="color:#218856;">Előrendelés kezdete:</strong>
                                        ${escapeHtml(formatDateTime(data.orderStart))}<br>
                                        <strong style="color:#218856;">Előrendelés vége:</strong>
                                        ${escapeHtml(formatDateTime(data.orderEnd))}
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;background:#fff9e9;border-left:3px solid #e8b931;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#4b5563;">
                                        <strong style="color:#8a6514;">Fontos tudnivalók</strong><br>
                                        Előrendeléseket kizárólag a meghirdetett időszakban, a rendelkezésre álló készlet erejéig tudunk fogadni.
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0;font-size:14px;line-height:22px;color:#4b5563;">
                                Az elérhető termékekről, az átvételi lehetőségekről és a további részletekről weboldalunkon tájékozódhat.
                            </p>

                            <div style="padding-top:28px;text-align:center;">
                                <a href="${orderUrl}" target="_blank" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#38b878;color:#ffffff;text-decoration:none;font-size:14px;line-height:22px;font-weight:700;">
                                    Előrendelés megnyitása
                                </a>
                            </div>

                            <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;font-size:14px;line-height:22px;color:#6b7280;font-style:italic;">
                                &#9993;&nbsp; Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.<br>
                                Kérdés vagy probléma esetén írjon a
                                <a href="mailto:hejjaokofarm@gmail.com" style="color:#218856;font-weight:700;text-decoration:none;">hejjaokofarm@gmail.com</a>
                                címre.
                            </p>

                            <p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#6b7280;">
                                Üdvözlettel!
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

export function buildSeasonLaunchEmail(
    data: SeasonLaunchData,
    options: SeasonLaunchEmailOptions = {},
): SeasonLaunchEmail {
    const seasonLabel = formatSeasonLabel(data.year, data.season);
    const subject = `Héjja Ökofarm – indul a ${seasonLabel.replace(/ szezon$/, " előrendelés")}!`;
    const orderUrl = options.orderUrl ?? DEFAULT_ORDER_URL;

    const text = [
        "Kedves Vásárlónk!",
        "",
        `A Héjja Ökofarm ${seasonLabel}jára hamarosan megnyílik az előrendelési lehetőség.`,
        "",
        seasonLabel,
        `Előrendelés kezdete: ${formatDateTime(data.orderStart)}`,
        `Előrendelés vége: ${formatDateTime(data.orderEnd)}`,
        "",
        "Fontos tudnivalók",
        "Előrendeléseket kizárólag a meghirdetett időszakban, a rendelkezésre álló készlet erejéig tudunk fogadni.",
        "",
        "Az elérhető termékekről, az átvételi lehetőségekről és a további részletekről weboldalunkon tájékozódhat.",
        "",
        `Előrendelés megnyitása: ${orderUrl}`,
        "",
        "Ez egy automatikus e-mail, kérjük, ne válaszoljon rá.",
        "Kérdés vagy probléma esetén: hejjaokofarm@gmail.com",
        "",
        "Üdvözlettel!",
        "Héjja Ökofarm",
    ].join("\n");

    return { subject, text, html: buildHtml(data, subject, options) };
}
