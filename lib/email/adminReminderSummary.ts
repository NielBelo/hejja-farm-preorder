import "server-only";

import { escapeHtml } from "@/lib/email/orderNotification";
import { isReminderSendingBlocked } from "@/lib/email/reminderGuard";
import { sendSmtp2GoEmail } from "@/lib/email/smtp2go";
import type { ReminderRunFailure, ReminderRunStats, ReminderRunUncertain } from "@/lib/email/reminderRun";

// A projekt már meglévő adminisztratív kapcsolattartási címe (lásd pl. a
// rendelési e-mailek lábléce lib/email/orderNotification.ts-ben) - nincs
// külön, új "admin notification" cím bevezetve, ahogy azt a feladat is
// kéri ("a projekt meglévő admin SMTP2GO infrastruktúráját használja").
const ADMIN_SUMMARY_RECIPIENT = "hejjaokofarm@gmail.com";

const runAtFormatter = new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Europe/Budapest",
});

const pickupDateFormatter = new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeZone: "Europe/Budapest",
});

function formatPickupDateLabel(pickupDateIso: string) {
    const date = new Date(`${pickupDateIso}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? pickupDateIso : pickupDateFormatter.format(date);
}

export type AdminReminderSummaryInput = {
    runAt: Date;
    pickupDateIso: string;
    stats: ReminderRunStats;
    failures: ReminderRunFailure[];
    uncertain: ReminderRunUncertain[];
};

export type AdminReminderSummary = {
    subject: string;
    text: string;
    html: string;
};

export function buildAdminReminderSummary(input: AdminReminderSummaryInput): AdminReminderSummary {
    const { runAt, pickupDateIso, stats, failures, uncertain } = input;
    const pickupDateLabel = formatPickupDateLabel(pickupDateIso);
    const runAtLabel = runAtFormatter.format(runAt);
    const subject = `Héjja Ökofarm – emlékeztető futás összesítő (${pickupDateLabel})`;

    const statRows: Array<[string, string]> = [
        ["Futás időpontja", runAtLabel],
        ["Érintett átvételi nap", pickupDateLabel],
        ["Jogosult rendelések száma", String(stats.eligibleCount)],
        ["Kiküldési kísérletek száma", String(stats.attemptedCount)],
        ["Sikeresen elküldött emlékeztetők", String(stats.sentCount)],
        ["Sikertelen emlékeztetők", String(stats.failedCount)],
        ["Kihagyott (korábban már elküldött) emlékeztetők", String(stats.skippedCount)],
        ["Bizonytalan (manuális ellenőrzést igénylő) emlékeztetők", String(stats.uncertainCount)],
    ];

    const text = [
        ...statRows.map(([label, value]) => `${label}: ${value}`),
        "",
        uncertain.length > 0
            ? [
                "Bizonytalan állapotú, manuális ellenőrzést igénylő küldések:",
                ...uncertain.map((item) => `- ${item.orderNumber} (${item.recipient}): ${item.detail}`),
            ].join("\n")
            : "Nem volt bizonytalan/stale állapotú reminder ebben a futásban.",
        "",
        failures.length > 0
            ? [
                "Sikertelen küldések:",
                ...failures.map((failure) => `- ${failure.orderNumber} (${failure.recipient}): ${failure.errorMessage}`),
            ].join("\n")
            : "Nem volt sikertelen küldés ebben a futásban.",
    ].join("\n");

    const statRowsHtml = statRows.map(([label, value]) => `
        <tr>
            <td style="padding:4px 12px 4px 0;color:#6b7280;">${escapeHtml(label)}:</td>
            <td style="padding:4px 0;font-weight:700;color:#374151;">${escapeHtml(value)}</td>
        </tr>`).join("");

    const uncertainHtml = uncertain.length > 0
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#fff9e9;border-left:3px solid #e8b931;border-radius:0 8px 8px 0;">
            <tr><td style="padding:12px 15px 4px;font-weight:700;color:#8a6514;">Bizonytalan állapotú küldések - manuális ellenőrzés szükséges</td></tr>
            ${uncertain.map((item) => `
            <tr>
                <td style="padding:6px 15px 12px;font-size:13px;line-height:20px;color:#4b5563;">
                    <strong>${escapeHtml(item.orderNumber)}</strong> (${escapeHtml(item.recipient)})<br>
                    <span style="color:#8a6514;">${escapeHtml(item.detail)}</span>
                </td>
            </tr>`).join("")}
        </table>`
        : `<p style="margin-top:18px;padding:12px 15px;background:#f1fbf6;border-left:3px solid #46cc8d;border-radius:0 8px 8px 0;color:#218856;font-weight:700;">Nem volt bizonytalan/stale állapotú reminder ebben a futásban.</p>`;

    const failuresHtml = failures.length > 0
        ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#fdecec;border-left:3px solid #dc4c4c;border-radius:0 8px 8px 0;">
            <tr><td style="padding:12px 15px 4px;font-weight:700;color:#7f1d1d;">Sikertelen küldések</td></tr>
            ${failures.map((failure) => `
            <tr>
                <td style="padding:6px 15px 12px;font-size:13px;line-height:20px;color:#4b5563;">
                    <strong>${escapeHtml(failure.orderNumber)}</strong> (${escapeHtml(failure.recipient)})<br>
                    <span style="color:#7f1d1d;">${escapeHtml(failure.errorMessage)}</span>
                </td>
            </tr>`).join("")}
        </table>`
        : `<p style="margin-top:18px;padding:12px 15px;background:#f1fbf6;border-left:3px solid #46cc8d;border-radius:0 8px 8px 0;color:#218856;font-weight:700;">Nem volt sikertelen küldés ebben a futásban.</p>`;

    const html = `<!doctype html>
<html lang="hu">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f5;color:#374151;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f7f5;">
        <tr>
            <td align="center" style="padding:28px 12px;">
                <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 3px 14px rgba(17,24,39,0.07);">
                    <tr>
                        <td style="padding:28px 34px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;">
                            <p style="margin:0 0 18px;font-weight:700;color:#374151;">Emlékeztető-küldés futásösszesítő</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="font-size:13px;">${statRowsHtml}</table>
                            ${uncertainHtml}
                            ${failuresHtml}
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

// Az admin futásösszesítő küldése UGYANAZT a guardot (lásd
// lib/email/reminderGuard.ts) használja, mint a vásárlói emlékeztető -
// localhoston/fejlesztői környezetben SOSEM megy ki ténylegesen, csak
// renderelve/logolva tesztelhető. Az esetleges küldési hiba (pl. SMTP2GO
// elérhetetlen) itt van elkapva és sosem dobódik tovább: a hívó
// (sendPickupReminders, lib/email/sendReminderEmail.ts) ekkorra már
// véglegesítette az összes vásárlói reminder állapotát és kiszámolta a
// visszaadott futási statisztikát - ezt ez a függvény nem módosíthatja és
// nem írhatja felül.
export async function sendAdminReminderSummary(input: AdminReminderSummaryInput): Promise<void> {
    const summary = buildAdminReminderSummary(input);

    if (isReminderSendingBlocked()) {
        console.warn(
            `[reminder] Admin futásösszesítő e-mail BLOKKOLVA (localhost/fejlesztői környezet) - `
            + `tárgy: "${summary.subject}".`,
        );
        return;
    }

    try {
        await sendSmtp2GoEmail({
            to: ADMIN_SUMMARY_RECIPIENT,
            subject: summary.subject,
            text: summary.text,
            html: summary.html,
        });
    } catch (error) {
        console.error("[reminder] Az admin futásösszesítő e-mail küldése sikertelen:", error);
    }
}
