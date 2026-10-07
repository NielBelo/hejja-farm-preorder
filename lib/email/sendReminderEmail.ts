import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildReminderEmail } from "@/lib/email/reminder";
import {
    getReminderOrderTargetsForDate,
    loadReminderOrdersBatch,
    type ReminderOrderTarget,
} from "@/lib/email/reminderData";
import type { LoadedOrderNotification } from "@/lib/email/orderNotificationData";
import { isBacsKiskunCounty } from "@/lib/countyGroups";
import { sendSmtp2GoEmail, isSmtp2GoUncertainError } from "@/lib/email/smtp2go";
import { isReminderSendingBlocked } from "@/lib/email/reminderGuard";
import { claimReminderSend, finalizeReminderSend, type ReminderClaim } from "@/lib/email/reminderSends";
import { formatSendingDuration, isStaleSending } from "@/lib/email/reminderStaleness";
import {
    processWithConcurrencyLimit,
    summarizeReminderOutcomes,
    type ReminderOutcome,
    type ReminderRunFailure,
    type ReminderRunStats,
    type ReminderRunUncertain,
} from "@/lib/email/reminderRun";

export { isReminderSendingBlocked } from "@/lib/email/reminderGuard";
export type { ReminderRunFailure, ReminderRunStats, ReminderRunUncertain } from "@/lib/email/reminderRun";

const SITE_URL = "https://hejja-okofarm.hu";

// Subrequest-költségvetés (Cloudflare Free: 50 / futás). Egy csomag feldolgozása
// (egy worker-futás) = 3 kötegelt betöltő-lekérdezés + rendelésenként
// 3 hívás (claim RPC, SMTP2GO, finalize RPC). 12 rendelés: 3 + 36 = 39 <= 50.
export const REMINDER_CHUNK_SIZE = 12;

// Egy csomagon belüli párhuzamosság: legfeljebb 5 egyidejű SMTP2GO-hívás.
const MAX_CONCURRENT_SENDS = 5;

// Csomagok egymás után futnak: így összesen is legfeljebb 5 SMTP2GO-hívás
// fut egyszerre, akkor is, ha több worker-futás van.
const MAX_CONCURRENT_CHUNKS = 1;

export type ReminderRunResult = {
    blocked: boolean;
    pickupDateIso: string;
    stats: ReminderRunStats;
    failures: ReminderRunFailure[];
    uncertain: ReminderRunUncertain[];
};

// Egy csomag feldolgozása. Alapértelmezetten helyben fut; a Worker a
// szolgáltatás-bindingen keresztül külön worker-futásba küldi (lásd
// worker/reminderChunk.ts), így minden csomag saját subrequest-keretet kap.
export type ReminderChunkRunner = (
    targets: ReminderOrderTarget[],
    runAt: Date,
) => Promise<ReminderOutcome[]>;

// Egy nem-lefoglalható ("claimed: false"), "sending" állapotú rekordra
// fut - ez vagy egy másik, épp aktívan dolgozó worker (friss), vagy egy
// korábbi worker megszakadt (crash/timeout) próbálkozásának maradványa
// (stale). A kettőt az attemptedAt kora dönti el (lásd
// lib/email/reminderStaleness.ts): friss esetben csendes skip, stale
// esetben - mivel NEM tudjuk biztosan, hogy az SMTP2GO végül elküldte-e az
// e-mailt - SOHA nem indítunk automatikus retry-t (az dupla ügyfél-e-mailt
// okozhatna), hanem "uncertain"-ként jelezzük, kézi ellenőrzésre várva.
function classifyUnclaimedSending(
    orderId: number,
    loaded: LoadedOrderNotification | undefined,
    attemptedAt: string | null,
    now: Date,
): ReminderOutcome {
    if (!isStaleSending(attemptedAt, now)) {
        return { kind: "skipped" };
    }

    return {
        kind: "uncertain",
        orderId,
        orderNumber: loaded?.data.orderNumber ?? String(orderId),
        recipient: loaded?.recipient ?? "",
        detail: `A reminder ${formatSendingDuration(attemptedAt, now)} "sending" állapotban van - a korábbi próbálkozás `
            + "workere feltehetően megszakadt, mielőtt az eredmény rögzülhetett volna. Az SMTP2GO tényleges válasza nem "
            + "ismert, ezért a rendszer NEM indított automatikus újraküldést (ez dupla e-mailt okozhatna) - kézi "
            + "ellenőrzés szükséges (pl. az SMTP2GO küldési naplójában), mielőtt a reminder bármilyen irányban "
            + "véglegesítésre kerülne.",
    };
}

function describeCaughtError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

// SMTP-küldés ELŐTTI hiba: a rekord failed-re zárul, így a következő futás
// újrapróbálhatja. A finalize maga is hibázhat - ilyenkor a sor "sending"
// marad, ami a stale-logika miatt később "uncertain"-ként jelenik meg, és
// SOHA nem küldődik automatikusan újra.
async function failBeforeSend(
    supabase: SupabaseClient,
    claimId: number,
    orderId: number,
    orderNumber: string,
    recipient: string,
    errorMessage: string,
): Promise<ReminderOutcome> {
    try {
        await finalizeReminderSend(supabase, claimId, { status: "failed", errorMessage });
    } catch (finalizeError) {
        console.error(`[reminder] A reminder-rekord lezárása is sikertelen (#${claimId}):`, finalizeError);
    }

    return { kind: "failed", orderId, orderNumber, recipient, errorMessage };
}

// Egyetlen rendelés feldolgozása, az előre betöltött adatokkal. SOHA nem dob
// ki hibát: minden hiba az adott rendelés outcome-jába kerül.
async function processLoadedReminder(
    supabase: SupabaseClient,
    target: ReminderOrderTarget,
    loaded: LoadedOrderNotification | undefined,
    now: Date,
): Promise<ReminderOutcome> {
    const { orderId, pickupDayId } = target;

    let claim: ReminderClaim;
    try {
        claim = await claimReminderSend(supabase, orderId, pickupDayId);
    } catch (error) {
        // Ilyenkor nincs lefoglalt sor, amit lezárni kellene - csak ez a
        // rendelés bukik el, a többi nem.
        return {
            kind: "failed",
            orderId,
            orderNumber: loaded?.data.orderNumber ?? String(orderId),
            recipient: loaded?.recipient ?? "",
            errorMessage: describeCaughtError(error, "Ismeretlen hiba a reminder-rekord lefoglalása közben."),
        };
    }

    if (!claim.claimed) {
        if (claim.status === "sending") {
            return classifyUnclaimedSending(orderId, loaded, claim.attemptedAt, now);
        }

        // "sent" - a reminder már korábban sikeresen kiment, ez sem
        // számít küldési kísérletnek.
        return { kind: "skipped" };
    }

    if (!loaded) {
        return failBeforeSend(
            supabase,
            claim.id,
            orderId,
            String(orderId),
            "",
            "A rendelés adatai nem tölthetők be (hiányos adat vagy a rendelés már nem érvényes).",
        );
    }

    const orderNumber = loaded.data.orderNumber;
    const recipient = loaded.recipient;
    let email: { subject: string; text: string; html: string };

    // 1. SMTP ELŐTTI szakasz: Bács-Kiskun ellenőrzés, levélépítés.
    try {
        if (isBacsKiskunCounty(loaded.data.county)) {
            // Védekező dupla ellenőrzés: getReminderOrderTargetsForDate már
            // kizárja a DUNAVECSE napot, de emlékeztető Bács-Kiskun
            // vármegyei vásárlónak így sem mehet ki.
            return failBeforeSend(
                supabase,
                claim.id,
                orderId,
                orderNumber,
                recipient,
                "Bács-Kiskun vármegyei (DUNAVECSE) vásárlónak nem küldhető emlékeztető.",
            );
        }

        const notification = buildReminderEmail(loaded.data, {
            logoSrc: `${SITE_URL}/images/logo2.png`,
            orderUrl: `${SITE_URL}/history?focusOrder=${loaded.data.orderId}#order-${loaded.data.orderId}`,
        });
        email = { subject: notification.subject, text: notification.text, html: notification.html };
    } catch (error) {
        return failBeforeSend(
            supabase,
            claim.id,
            orderId,
            orderNumber,
            recipient,
            describeCaughtError(error, "Ismeretlen hiba a reminder küldése előkészítése közben."),
        );
    }

    // 2. SMTP-küldés. Hiba esetén a küldés nem sikerült -> failed (retry engedett).
    let providerMessageId: string;
    try {
        const delivery = await sendSmtp2GoEmail({
            to: recipient,
            subject: email.subject,
            text: email.text,
            html: email.html,
        });
        providerMessageId = delivery.id;
    } catch (error) {
        if (isSmtp2GoUncertainError(error)) {
            // Hálózati hiba / timeout / 5xx / olvashatatlan válasz: a provider
            // elfogadhatta a levelet, ezért NEM failed (az újrapróbálást engedné).
            return {
                kind: "uncertain",
                sendAttempted: true,
                orderId,
                orderNumber,
                recipient,
                detail: "Az SMTP2GO-hívás hálózati hibával, időtúllépéssel vagy bizonytalan válasszal ért véget, "
                    + "ezért nem tudjuk, kézbesítette-e a levelet. A rekord 'sending' állapotban maradt, "
                    + "NEM indult újraküldés. Ellenőrizd az SMTP2GO küldési naplójában, mielőtt bármit módosítasz.",
            };
        }

        // Egyértelmű elutasítás vagy lokális, küldés előtti hiba (pl. hiányzó API-kulcs): failed.
        return failBeforeSend(
            supabase,
            claim.id,
            orderId,
            orderNumber,
            recipient,
            describeCaughtError(error, "Ismeretlen hiba az SMTP2GO-küldés közben."),
        );
    }

    // 3. SMTP SIKER UTÁN. Az e-mail már elment, ezért a finalize hiba NEM
    // lehet failed: az újrapróbálást engedné, és ügyfélnek duplán menne ki.
    // A sor "sending" marad, a kézi ellenőrzésig "uncertain".
    try {
        await finalizeReminderSend(supabase, claim.id, { status: "sent", providerMessageId });
        return { kind: "sent" };
    } catch (finalizeError) {
        console.error(`[reminder] A sikeres küldés után a "sent" lezárás elhasalt (#${claim.id}):`, finalizeError);
        return {
            kind: "uncertain",
            sendAttempted: true,
            orderId,
            orderNumber,
            recipient,
            detail: "Az SMTP2GO elfogadta az e-mailt (provider azonosító: "
                + `${providerMessageId}), de a reminder-rekord "sent" állapotba írása sikertelen volt. `
                + "A rekord 'sending' állapotban maradt, ezért NEM indult újraküldés. Ellenőrizd az SMTP2GO "
                + "küldési naplójában, és kézzel zárd le a rekordot.",
        };
    }
}

// Egy csomag (legfeljebb REMINDER_CHUNK_SIZE rendelés) feldolgozása.
// Az adatokat egy kötegelt lekérdezéssel tölti be (3 subrequest a csomagra),
// majd rendelésenként claim -> SMTP2GO -> finalize. SOHA nem dob ki hibát:
// ha a kötegelt betöltés elhasal, még egyetlen rekord sem foglalódott le,
// ezért a csomag rendelései "failed"-ként kerülnek a naplóba, és a
// következő futás újrapróbálhatja őket.
export async function processReminderChunk(
    supabase: SupabaseClient,
    targets: ReminderOrderTarget[],
    runAt: Date,
): Promise<ReminderOutcome[]> {
    let loaded: Map<number, LoadedOrderNotification>;
    try {
        loaded = await loadReminderOrdersBatch(supabase, targets.map((target) => target.orderId));
    } catch (error) {
        const errorMessage = describeCaughtError(error, "Ismeretlen hiba a rendelésadatok betöltése közben.");
        return targets.map((target) => ({
            kind: "failed",
            orderId: target.orderId,
            orderNumber: String(target.orderId),
            recipient: "",
            errorMessage,
        }));
    }

    return processWithConcurrencyLimit(
        targets,
        MAX_CONCURRENT_SENDS,
        (target) => processLoadedReminder(supabase, target, loaded.get(target.orderId), runAt),
    );
}

// Egyetlen rendelés feldolgozása (visszafelé kompatibilis belépési pont a
// kézi pótló scriptekhez). Ugyanazt a csomag-útvonalat használja.
export async function processOneReminder(
    supabase: SupabaseClient,
    orderId: number,
    pickupDayId: number,
    now: Date,
): Promise<ReminderOutcome> {
    const [outcome] = await processReminderChunk(supabase, [{ orderId, pickupDayId }], now);
    return outcome;
}

function chunkTargets(targets: ReminderOrderTarget[], size: number): ReminderOrderTarget[][] {
    const chunks: ReminderOrderTarget[][] = [];
    for (let index = 0; index < targets.length; index += size) {
        chunks.push(targets.slice(index, index + size));
    }
    return chunks;
}

// Egy csomag futtatása legfeljebb kétszer. Az újrapróbálás biztonságos: a
// claim atomi, így a már elküldött (sent) vagy épp folyamatban lévő (friss
// sending) rekordokat a második próbálkozás egyszerűen kihagyja - duplikált
// küldés nem lehetséges. Ha mindkét próbálkozás hibás, a csomag rendelései
// "uncertain"-ként kerülnek a futási eredménybe, és NEM küldődnek újra.
async function runChunkWithRetry(
    runner: ReminderChunkRunner,
    chunk: ReminderOrderTarget[],
    runAt: Date,
): Promise<ReminderOutcome[]> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            return await runner(chunk, runAt);
        } catch (error) {
            console.error(`[reminder] ${chunk.length} rendelés csomagjának feldolgozása elhasalt (${attempt}. próba):`, error);
        }
    }

    return chunk.map((target) => ({
        kind: "uncertain",
        orderId: target.orderId,
        orderNumber: String(target.orderId),
        recipient: "",
        detail: "A feldolgozó csomag ismételten hibával ért véget, ezért ennek a rendelésnek az eredménye nem ismert. "
            + "Ellenőrizd a reminder-naplóban (sent / sending / failed). Automatikus újraküldés NEM történt.",
    }));
}

// A jövőbeli napi ütemezett feladat (lásd worker/index.ts) ezt a függvényt
// hívja meg az átvételi nap dátumával ("YYYY-MM-DD", Europe/Budapest).
//
// Idempotencia: rendelésenként a lib/email/reminderSends.ts atomikus
// claim/finalize RPC-in (public.claim_reminder_send /
// finalize_reminder_send) keresztül - ugyanaz a rendelés ugyanarra az
// átvételi napra legfeljebb egyszer kaphat sikeresen kiküldött emlékeztetőt,
// még konkurens futás esetén is. A "sending" állapotban ragadt (stale)
// rekordokból SOHA nem indítunk automatikus retry-t.
//
// Admin összesítő e-mail: KIKAPCSOLVA (nem hívódik sehol ebből az útvonalból).
//
// A runChunk paraméter opcionális: a Worker a csomagokat külön worker-
// futásba küldi (szolgáltatás-binding), alapértelmezetten helyben futnak.
export async function sendPickupReminders(
    supabase: SupabaseClient,
    pickupDateIso: string,
    runChunk?: ReminderChunkRunner,
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

    const runner: ReminderChunkRunner = runChunk
        ?? ((chunk, now) => processReminderChunk(supabase, chunk, now));

    const chunkOutcomes = await processWithConcurrencyLimit(
        chunkTargets(targets, REMINDER_CHUNK_SIZE),
        MAX_CONCURRENT_CHUNKS,
        (chunk) => runChunkWithRetry(runner, chunk, runAt),
    );
    const outcomes = chunkOutcomes.flat();

    if (outcomes.length !== targets.length) {
        // Ez nem fordulhat elő (minden csomag minden rendeléshez ad outcome-ot),
        // de ha mégis, legyen hangos a napló.
        console.error(`[reminder] HIBA: ${targets.length} rendelésből csak ${outcomes.length} kapott eredményt.`);
    }

    const stats = summarizeReminderOutcomes(outcomes, targets.length);
    const failures: ReminderRunFailure[] = outcomes
        .filter((outcome): outcome is Extract<ReminderOutcome, { kind: "failed" }> => outcome.kind === "failed")
        .map(({ orderId, orderNumber, recipient, errorMessage }) => ({ orderId, orderNumber, recipient, errorMessage }));
    const uncertain: ReminderRunUncertain[] = outcomes
        .filter((outcome): outcome is Extract<ReminderOutcome, { kind: "uncertain" }> => outcome.kind === "uncertain")
        .map(({ orderId, orderNumber, recipient, detail }) => ({ orderId, orderNumber, recipient, detail }));

    return { blocked: false, pickupDateIso, stats, failures, uncertain };
}
