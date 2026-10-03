import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReminderSendStatus = "pending" | "sending" | "sent" | "failed";

export type ReminderClaim = {
    id: number;
    claimed: boolean;
    status: ReminderSendStatus;
    /**
     * Mióta van a sor a jelenlegi státuszban "sending" esetén (ISO
     * timestamp), akár ezt a hívást foglalta le épp most, akár egy
     * korábbi (esetleg megszakadt) próbálkozásé. A hívó ebből dönti el,
     * hogy egy nem-lefoglalható "sending" sor friss-e (más worker dolgozik
     * rajta) vagy stale (lásd lib/email/reminderStaleness.ts).
     */
    attemptedAt: string | null;
};

// Atomikus, konkurencia-biztos "lefoglalás": a public.claim_reminder_send
// Postgres-függvény (lásd
// supabase/migrations/20260930000000_reminder_sends.sql és
// supabase/migrations/20260930010000_reminder_sends_claim_attempted_at.sql)
// egyetlen tranzakcióban hozza létre (ha még nem létezik) és zárolja
// "sending" állapotba a rendelés+átvételi nap párhoz tartozó
// reminder-rekordot - de csak akkor, ha az még sosem volt "sent", és
// jelenleg sincs "sending" állapotban (azaz épp nem dolgozza fel másik
// worker). Ha két hívás egyszerre próbálkozik ugyanazzal a kulccsal, a
// Postgres sorszintű zárolása miatt csak az egyik kaphat claimed=true-t.
//
// FONTOS: ez a függvény SOHA nem foglal le egy már "sending" állapotú
// sort újra, még akkor sem, ha az régóta (stale-en) abban az állapotban
// ragadt - a stale eset felismerése és biztonságos (nem-automatikus-retry)
// kezelése a hívó (lib/email/sendReminderEmail.ts) felelőssége, az
// attemptedAt mező alapján.
export async function claimReminderSend(
    supabase: SupabaseClient,
    orderId: number,
    pickupDayId: number,
): Promise<ReminderClaim> {
    const { data, error } = await supabase.rpc("claim_reminder_send", {
        p_order_id: orderId,
        p_pickup_day_id: pickupDayId,
    });

    if (error) {
        throw new Error(`A reminder-rekord lefoglalása sikertelen (rendelés #${orderId}): ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
        throw new Error(`A reminder-rekord lefoglalása nem adott vissza eredményt (rendelés #${orderId}).`);
    }

    return {
        id: row.id,
        claimed: row.claimed,
        status: row.status,
        attemptedAt: row.attempted_at ?? null,
    };
}

export type ReminderFinalizeOutcome =
    | { status: "sent"; providerMessageId: string }
    | { status: "failed"; errorMessage: string };

// A claimReminderSend által "sending"-re állított rekordot zárja le - csak
// akkor ír "sent"-et, ha a hívó ezt tényleges, sikeres SMTP2GO-válasz UTÁN
// hívja meg. A public.finalize_reminder_send csak a jelenleg "sending"
// állapotú sort módosítja, így egy elkésett/duplikált hívás nem írhat felül
// egy már véglegesített sort.
export async function finalizeReminderSend(
    supabase: SupabaseClient,
    id: number,
    outcome: ReminderFinalizeOutcome,
): Promise<void> {
    const { error } = await supabase.rpc("finalize_reminder_send", {
        p_id: id,
        p_status: outcome.status,
        p_provider_message_id: outcome.status === "sent" ? outcome.providerMessageId : null,
        p_error_message: outcome.status === "failed" ? outcome.errorMessage.slice(0, 500) : null,
    });

    if (error) {
        throw new Error(`A reminder-rekord lezárása sikertelen (#${id}): ${error.message}`);
    }
}
