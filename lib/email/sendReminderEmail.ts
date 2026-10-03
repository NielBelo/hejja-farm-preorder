import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReminderEmail } from "@/lib/email/reminder";
import { getReminderOrderTargetsForDate } from "@/lib/email/reminderData";
import { loadOrderNotificationData } from "@/lib/email/orderNotificationData";
import { isBacsKiskunCounty } from "@/lib/countyGroups";
import { sendSmtp2GoEmail } from "@/lib/email/smtp2go";
import { isReminderSendingBlocked } from "@/lib/email/reminderGuard";
import { claimReminderSend, finalizeReminderSend } from "@/lib/email/reminderSends";
import { formatSendingDuration, isStaleSending } from "@/lib/email/reminderStaleness";
import {
    processWithConcurrencyLimit,
    shouldSendAdminReminderSummary,
    summarizeReminderOutcomes,
    type ReminderOutcome,
    type ReminderRunFailure,
    type ReminderRunStats,
    type ReminderRunUncertain,
} from "@/lib/email/reminderRun";
import { sendAdminReminderSummary } from "@/lib/email/adminReminderSummary";

export { isReminderSendingBlocked } from "@/lib/email/reminderGuard";
export type { ReminderRunFailure, ReminderRunStats, ReminderRunUncertain } from "@/lib/email/reminderRun";

const SITE_URL = "https://hejja-okofarm.hu";

// Ne induljon 50 (vagy több) párhuzamos HTTP-hívás az SMTP2GO felé egy
// nagyobb napi kiküldésnél - legfeljebb ennyi rendelés feldolgozása fut
// egyszerre (lásd lib/email/reminderRun.ts processWithConcurrencyLimit).
const MAX_CONCURRENT_SENDS = 5;

export type ReminderRunResult = {
    blocked: boolean;
    pickupDateIso: string;
    stats: ReminderRunStats;
    failures: ReminderRunFailure[];
    uncertain: ReminderRunUncertain[];
};

// Egy nem-lefoglalható ("claimed: false"), "sending" állapotú rekordra
// fut - ez vagy egy másik, épp aktívan dolgozó worker (friss), vagy egy
// korábbi worker megszakadt (crash/timeout) próbálkozásának maradványa
// (stale). A kettőt az attemptedAt kora dönti el (lásd
// lib/email/reminderStaleness.ts): friss esetben csendes skip, stale
// esetben - mivel NEM tudjuk biztosan, hogy az SMTP2GO végül elküldte-e az
// e-mailt - SOHA nem indítunk automatikus retry-t (az dupla ügyfél-e-mailt
// okozhatna), hanem "uncertain"-ként jelezzük, kézi ellenőrzésre várva.
async function classifyUnclaimedSending(
    supabase: SupabaseClient,
    orderId: number,
    attemptedAt: string | null,
    now: Date,
): Promise<ReminderOutcome> {
    if (!isStaleSending(attemptedAt, now)) {
        return { kind: "skipped" };
    }

    let orderNumber = String(orderId);
    let recipient = "";

    try {
        const loaded = await loadOrderNotificationData(supabase, { orderId }, "created", { asAdmin: true });
        orderNumber = loaded.data.orderNumber;
        recipient = loaded.recipient;
    } catch (error) {
        // Ha még a rendelésadat betöltése is sikertelen, a rendelésszám/
        // címzett helyett az azonosítóval jelezzük - az "uncertain" jelzés
        // ettől függetlenül megjelenik az admin összesítőben, hogy a
        // problémát akkor se nyelje el a rendszer csendben.
        console.error(`[reminder] Rendelésadat betöltése sikertelen egy stale "sending" reminderhez (#${orderId}):`, error);
    }

    return {
        kind: "uncertain",
        orderId,
        orderNumber,
        recipient,
        detail: `A reminder ${formatSendingDuration(attemptedAt, now)} "sending" állapotban van - a korábbi próbálkozás `
            + "workere feltehetően megszakadt, mielőtt az eredmény rögzülhetett volna. Az SMTP2GO tényleges válasza nem "
            + "ismert, ezért a rendszer NEM indított automatikus újraküldést (ez dupla e-mailt okozhatna) - kézi "
            + "ellenőrzés szükséges (pl. az SMTP2GO küldési naplójában), mielőtt a reminder bármilyen irányban "
            + "véglegesítésre kerülne.",
    };
}

async function processOneReminder(
    supabase: SupabaseClient,
    orderId: number,
    pickupDayId: number,
    now: Date,
): Promise<ReminderOutcome> {
    const claim = await claimReminderSend(supabase, orderId, pickupDayId);

    if (!claim.claimed) {
        if (claim.status === "sending") {
            return classifyUnclaimedSending(supabase, orderId, claim.attemptedAt, now);
        }

        // "sent" - a reminder már korábban sikeresen kiment, ez sem
        // számít küldési kísérletnek.
        return { kind: "skipped" };
    }

    let orderNumber = String(orderId);
    let recipient = "";

    try {
        const loaded = await loadOrderNotificationData(
            supabase,
            { orderId },
            "created",
            { asAdmin: true },
        );
        orderNumber = loaded.data.orderNumber;
        recipient = loaded.recipient;

        if (isBacsKiskunCounty(loaded.data.county)) {
            // Védekező dupla ellenőrzés: getReminderOrderTargetsForDate már
            // kizárja a DUNAVECSE napot, de emlékeztető Bács-Kiskun
            // vármegyei vásárlónak így sem mehet ki. A már lefoglalt
            // rekordot failed-ként zárjuk le (nem maradhat örökre
            // "sending" állapotban), a hiba pedig megjelenik az admin
            // futásösszesítőben.
            const errorMessage = "Bács-Kiskun vármegyei (DUNAVECSE) vásárlónak nem küldhető emlékeztető.";
            await finalizeReminderSend(supabase, claim.id, { status: "failed", errorMessage });
            return { kind: "failed", orderId, orderNumber, recipient, errorMessage };
        }

        const notification = buildReminderEmail(loaded.data, {
            logoSrc: `${SITE_URL}/images/logo2.png`,
            orderUrl: `${SITE_URL}/history?focusOrder=${loaded.data.orderId}#order-${loaded.data.orderId}`,
        });

        const delivery = await sendSmtp2GoEmail({
            to: recipient,
            subject: notification.subject,
            text: notification.text,
            html: notification.html,
        });

        await finalizeReminderSend(supabase, claim.id, { status: "sent", providerMessageId: delivery.id });
        return { kind: "sent" };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Ismeretlen hiba a reminder küldése közben.";

        try {
            await finalizeReminderSend(supabase, claim.id, { status: "failed", errorMessage });
        } catch (finalizeError) {
            console.error(`[reminder] A reminder-rekord lezárása is sikertelen (#${claim.id}):`, finalizeError);
        }

        // Egyetlen hibás címzett nem állítja le a teljes futást - a hívó
        // (processWithConcurrencyLimit) a többi rendelést a hibától
        // függetlenül folytatja.
        return { kind: "failed", orderId, orderNumber, recipient, errorMessage };
    }
}

// A jövőbeli napi ütemezett feladat (lásd worker/index.ts) ezt a függvényt
// hívja meg egyetlen argumentummal: a másnapi átvételi nap dátumával
// ("YYYY-MM-DD", Europe/Budapest naptári nap). A meglévő SMTP2GO-
// integrációt (lib/email/smtp2go.ts) használja újra - nincs új
// e-mailszolgáltató bevezetve.
//
// Idempotencia: rendelésenként a lib/email/reminderSends.ts atomikus
// claim/finalize RPC-in (public.claim_reminder_send /
// finalize_reminder_send, lásd
// supabase/migrations/20260930000000_reminder_sends.sql és
// supabase/migrations/20260930010000_reminder_sends_claim_attempted_at.sql)
// keresztül - ugyanaz a rendelés ugyanarra az átvételi napra legfeljebb
// egyszer kaphat sikeresen kiküldött emlékeztetőt, még konkurens futás
// esetén is. Worker crash/timeout esetén (a claim UTÁN, a finalize ELŐTT)
// a rekord "sending" állapotban ragad - ezt a lib/email/reminderStaleness.ts
// alapján "stale"-ként ismerjük fel, és SOHA nem indítunk belőle
// automatikus retry-t (lásd classifyUnclaimedSending fent).
export async function sendPickupReminders(
    supabase: SupabaseClient,
    pickupDateIso: string,
): Promise<ReminderRunResult> {
    const runAt = new Date();
    const targets = await getReminderOrderTargetsForDate(supabase, pickupDateIso);

    if (isReminderSendingBlocked()) {
        console.warn(
            `[reminder] SMTP2GO-küldés BLOKKOLVA (NODE_ENV=${process.env.NODE_ENV ?? "development"}, `
            + `REMINDER_EMAIL_SENDING_ENABLED=${process.env.REMINDER_EMAIL_SENDING_ENABLED ?? "nincs beállítva"}) - `
            + `${targets.length} jogosult rendelés egyikét sem próbáljuk megküldeni, és egyiket sem foglaljuk le `
            + `a reminder naplóban, hogy localhoston/teszt közben ne keletkezzen hamis "sent" állapot. `
            + `Érintett átvételi nap: ${pickupDateIso}.`,
        );

        return {
            blocked: true,
            pickupDateIso,
            stats: {
                eligibleCount: targets.length,
                attemptedCount: 0,
                sentCount: 0,
                failedCount: 0,
                skippedCount: 0,
                uncertainCount: 0,
            },
            failures: [],
            uncertain: [],
        };
    }

    const outcomes = await processWithConcurrencyLimit(
        targets,
        MAX_CONCURRENT_SENDS,
        (target) => processOneReminder(supabase, target.orderId, target.pickupDayId, runAt),
    );

    const stats = summarizeReminderOutcomes(outcomes, targets.length);
    const failures: ReminderRunFailure[] = outcomes
        .filter((outcome): outcome is Extract<ReminderOutcome, { kind: "failed" }> => outcome.kind === "failed")
        .map(({ orderId, orderNumber, recipient, errorMessage }) => ({ orderId, orderNumber, recipient, errorMessage }));
    const uncertain: ReminderRunUncertain[] = outcomes
        .filter((outcome): outcome is Extract<ReminderOutcome, { kind: "uncertain" }> => outcome.kind === "uncertain")
        .map(({ orderId, orderNumber, recipient, detail }) => ({ orderId, orderNumber, recipient, detail }));

    // Pontos szabály: attemptedCount = 0 -> nincs admin összesítő,
    // attemptedCount >= 1 -> pontosan egy megy ki. Az uncertainCount
    // önmagában NEM triggerel admin e-mailt - de ha a feltétel úgyis
    // teljesül, a stale/bizonytalan rekordok is szerepelnek az
    // összesítőben (lásd lib/email/adminReminderSummary.ts). Az összesítő
    // küldése (és annak esetleges hibája) a fent már kiszámolt
    // stats/failures/uncertain eredményt nem módosíthatja - a
    // sendAdminReminderSummary a saját hibáit maga is elnyeli, de ide egy
    // extra try/catch is kerül védekezésül, hogy egy váratlan hiba se
    // akadályozhassa meg a már véglegesített futási eredmény visszaadását.
    if (shouldSendAdminReminderSummary(stats)) {
        try {
            await sendAdminReminderSummary({ runAt, pickupDateIso, stats, failures, uncertain });
        } catch (error) {
            console.error("[reminder] Az admin futásösszesítő e-mail küldése váratlanul elhasalt:", error);
        }
    }

    return { blocked: false, pickupDateIso, stats, failures, uncertain };
}
