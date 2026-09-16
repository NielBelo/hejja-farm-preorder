import "server-only";

export type RegistrationConfirmationData = {
    firstName: string;
    confirmationUrl: string;
};

export type RegistrationConfirmationOptions = {
    logoSrc?: string;
};

export type RegistrationConfirmation = {
    subject: string;
    text: string;
    html: string;
};

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function buildRegistrationConfirmation(
    data: RegistrationConfirmationData,
    options: RegistrationConfirmationOptions = {},
): RegistrationConfirmation {
    const subject = "Héjja-Farm – erősítsd meg az e-mail-címedet";
    const firstName = escapeHtml(data.firstName);
    const confirmationUrl = escapeHtml(data.confirmationUrl);
    const logoSrc = escapeHtml(options.logoSrc ?? "cid:hejja-logo");

    const text = [
        `Kedves ${data.firstName}!`,
        "",
        "Már csak egy lépés van hátra.",
        "A Héjja-Farm fiókod aktiválásához erősítsd meg az e-mail-címedet:",
        data.confirmationUrl,
        "",
        "Ha nem te kezdeményezted a regisztrációt, nincs további teendőd.",
        "",
        "Ez egy automatikus e-mail, kérjük, ne válaszolj rá.",
        "Kérdés esetén: hejja-farm-csirke@gmail.com",
        "",
        "Üdvözlettel:",
        "Héjja Ökofarm",
    ].join("\n");

    const html = `<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f5;color:#374151;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
        Erősítsd meg az e-mail-címedet a Héjja-Farm fiókod aktiválásához.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f5;">
        <tr>
            <td align="center" style="padding:28px 12px;">
                <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(17,24,39,0.07);">
                    <tr>
                        <td align="center" style="padding:28px 34px 24px;background:#f1fbf6;border-bottom:1px solid #dcefe4;font-family:Arial,Helvetica,sans-serif;">
                            <img src="${logoSrc}" width="64" height="64" alt="Héjja Ökofarm" style="display:block;width:64px;height:64px;border:0;">
                            <div style="padding-top:12px;font-size:14px;line-height:22px;font-weight:700;color:#374151;">
                                Héjja Ökofarm
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:30px 34px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">
                            <p style="margin:0 0 20px;color:#4b5563;">
                                Kedves ${firstName}!
                            </p>

                            <h1 style="margin:0 0 12px;font-size:14px;line-height:22px;color:#374151;">
                                Már csak egy lépés van hátra.
                            </h1>

                            <p style="margin:0;color:#4b5563;">
                                A Héjja-Farm fiókod aktiválásához erősítsd meg az e-mail-címedet az alábbi gombbal.
                            </p>

                            <div style="padding:30px 0;text-align:center;">
                                <a href="${confirmationUrl}" target="_blank" style="display:inline-block;padding:13px 26px;border-radius:8px;background:#38b878;color:#ffffff;text-decoration:none;font-size:14px;line-height:22px;font-weight:700;">
                                    E-mail-cím megerősítése
                                </a>
                            </div>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff9e9;border-left:3px solid #e8b931;border-radius:0 8px 8px 0;">
                                <tr>
                                    <td style="padding:15px 17px;font-size:14px;line-height:22px;color:#4b5563;">
                                        <strong style="color:#8a6514;">Nem te kezdeményezted?</strong><br>
                                        Ha nem te regisztráltál, nincs további teendőd, ezt az e-mailt figyelmen kívül hagyhatod.
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e5e7eb;font-size:14px;line-height:22px;color:#6b7280;font-style:italic;">
                                &#9993;&nbsp; Ez egy automatikus e-mail, kérjük, ne válaszolj rá.<br>
                                Kérdés vagy probléma esetén írj a
                                <a href="mailto:hejja-farm-csirke@gmail.com" style="color:#218856;font-weight:700;text-decoration:none;">hejja-farm-csirke@gmail.com</a>
                                címre.
                            </p>

                            <p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#6b7280;">
                                Üdvözlettel:<br>
                                <strong style="color:#4b5563;">Héjja Ökofarm</strong>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    return { subject, text, html };
}
