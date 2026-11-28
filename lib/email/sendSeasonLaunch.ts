import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSeasonLaunchEmail, type SeasonLaunchData } from "@/lib/email/seasonLaunch";
import { sendSmtp2GoEmail, isSmtp2GoUncertainError } from "@/lib/email/smtp2go";
import { getSeasonLaunchTestRecipients, isSeasonLaunchSendingBlocked } from "@/lib/email/seasonLaunchGuard";
import {
    claimSeasonLaunchSend,
    finalizeSeasonLaunchSend,
    type SeasonLaunchClaim,
} from "@/lib/email/seasonLaunchSends";
import { isStaleSending } from "@/lib/email/reminderStaleness";
import { processWithConcurrencyLimit } from "@/lib/email/reminderRun";
import { getCalendarDate } from "@/lib/orderWindow";

export { isSeasonLaunchSendingBlocked } from "@/lib/email/seasonLaunchGuard";

const SITE_URL = "https://hejja-okofarm.hu";

// Subrequest-költségvetés (Cloudflare Free: 50 / futás): címzettenként 3 hívás
// (claim RPC, SMTP2GO, finalize RPC), a csomag adatait a hívó adja át, így
// nincs betöltő lekérdezés. 8 címzett: 24 <= 50 (bő tartalékkal a váratlan
// újrapróbálásokra és a futás egyéb subrequestjeire).
export const SEASON_LAUNCH_CHUNK_SIZE = 8;
const MAX_CONCURRENT_SENDS = 5;
const PROFILE_PAGE_SIZE = 1000;

export type SeasonLaunchSeason = SeasonLaunchData & { id: number };

export type SeasonLaunchRecipient = { userId: string; email: string };

export type SeasonLaunchOutcome =
    | { kind: "skipped" }
    | { kind: "sent" }
    | { kind: "failed"; email: string; errorMessage: string }
    | { kind: "uncertain"; email: string; detail: string };

export type SeasonLaunchChunkRunner = (
    season: SeasonLaunchSeason,
    recipients: SeasonLaunchRecipient[],
    runAt: Date,
) => Promise<SeasonLaunchOutcome[]>;

// send: csak tesztben adható meg (a küldő cseréje), éles útvonalon SOSEM adjuk
// át, ezért a guard ott megkerülhetetlen.
// sendingEnabled: a superadmin kapcsolójának (KV) állapota, a hívó olvassa be;
// hiányában KIKAPCSOLTNAK számít.
export type SeasonLaunchDeps = {
    send?: typeof sendSmtp2GoEmail;
    sendingEnabled?: boolean;
};

export type SeasonLaunchRunResult = {
    blocked: boolean;
    dateIso: string;
    seasonIds: number[];
    recipientCount: number;
    sentCount: number;
    skippedCount: number;
    failedCount: number;
    uncertainCount: number;
    failures: { email: string; errorMessage: string }[];
    uncertain: { email: string; detail: string }[];
};

// Teszt-címzett szűkítés (SEASON_LAUNCH_TEST_RECIPIENT): beállított értéknél
// csak a felsorolt címek maradnak; üres lista = senki. A lista összeállításakor
// ÉS közvetlenül a küldés előtt is lefut (kettős védelem).
export function applyTestRecipientFilter(recipients: SeasonLaunchRecipient[]): SeasonLaunchRecipient[] {
    const allowedAddresses = getSeasonLaunchTestRecipients();
    return allowedAddresses
        ? recipients.filter((recipient) => allowedAddresses.includes(recipient.email.trim().toLowerCase()))
        : recipients;
}

function describeCaughtError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

// A kezdőnapon (Europe/Budapest naptári nap) induló, nem törölt szezonok,
// amelyek előrendelési időszaka még nem ért véget. Utólag SOSEM küldünk: a
// kezdőnap után ez a lista üres.
export async function getSeasonsStartingOn(
    supabase: SupabaseClient,
    dateIso: string,
    now: Date,
): Promise<SeasonLaunchSeason[]> {
    // A dátum körüli ±2 napos UTC-sáv elég a budapesti naptári nap lefedéséhez;
    // a pontos egyezést getCalendarDate dönti el.
    const from = new Date(`${dateIso}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 2);
    const to = new Date(`${dateIso}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 2);

    const { data, error } = await supabase
        .from("season_parameters")
        .select("id, year, season, time_window_start, time_window_end")
        .is("archived_at", null)
        .not("time_window_start", "is", null)
        .not("time_window_end", "is", null)
        .gte("time_window_start", from.toISOString())
        .lte("time_window_start", to.toISOString());

    if (error) {
        throw new Error(error.message);
    }

    return (data ?? [])
        .filter((row) => getCalendarDate(row.time_window_start as string) === dateIso)
        .filter((row) => new Date(row.time_window_end as string).getTime() > now.getTime())
        .map((row) => ({
            id: row.id as number,
            year: row.year as number,
            season: row.season as string,
            orderStart: row.time_window_start as string,
            orderEnd: row.time_window_end as string,
        }));
}

// Minden regisztrált vásárló e-mail-címmel (lapozva, mert a Supabase
// alapértelmezett sorlimitje 1000). A teszt-címzett szűkítés itt is érvényes.
export async function listSeasonLaunchRecipients(supabase: SupabaseClient): Promise<SeasonLaunchRecipient[]> {
    const recipients: SeasonLaunchRecipient[] = [];

    for (let offset = 0; ; offset += PROFILE_PAGE_SIZE) {
        const { data, error } = await supabase
            .from("profiles")
            .select("id, email")
            .order("id")
            .range(offset, offset + PROFILE_PAGE_SIZE - 1);

        if (error) {
            throw new Error(error.message);
        }

        for (const row of data ?? []) {
            const email = typeof row.email === "string" ? row.email.trim() : "";
            if (email) {
                recipients.push({ userId: row.id as string, email });
            }
        }

        if ((data?.length ?? 0) < PROFILE_PAGE_SIZE) {
            break;
        }
    }

    return applyTestRecipientFilter(recipients);
}

async function failBeforeSend(
    supabase: SupabaseClient,
    claimId: number,
    email: string,
    errorMessage: string,
): Promise<SeasonLaunchOutcome> {
    try {
        await finalizeSeasonLaunchSend(supabase, claimId, { status: "failed", errorMessage });
    } catch (finalizeError) {
        console.error(`[season-launch] A rekord lezárása is sikertelen (#${claimId}):`, finalizeError);
    }

    return { kind: "failed", email, errorMessage };
}

async function processRecipient(
    supabase: SupabaseClient,
    season: SeasonLaunchSeason,
    recipient: SeasonLaunchRecipient,
    now: Date,
    send: typeof sendSmtp2GoEmail,
): Promise<SeasonLaunchOutcome> {
    const { userId, email } = recipient;

    let claim: SeasonLaunchClaim;
    try {
        claim = await claimSeasonLaunchSend(supabase, season.id, userId, email);
    } catch (error) {
        return { kind: "failed", email, errorMessage: describeCaughtError(error, "Ismeretlen hiba a lefoglalás közben.") };
    }

    if (!claim.claimed) {
        if (claim.status === "sending" && isStaleSending(claim.attemptedAt, now)) {
            // Megszakadt korábbi kísérlet: nem tudjuk, kiment-e a levél, ezért
            // SOHA nem küldjük újra automatikusan.
            return {
                kind: "uncertain",
                email,
                detail: "A szezonértesítő régóta 'sending' állapotban van - a korábbi kísérlet eredménye ismeretlen, "
                    + "automatikus újraküldés NEM történt. Ellenőrizd az SMTP2GO küldési naplóját.",
            };
        }
        // "sent" vagy friss "sending": nem kísérlet.
        return { kind: "skipped" };
    }

    let email_: { subject: string; text: string; html: string };
    try {
        email_ = buildSeasonLaunchEmail(season, {
            logoSrc: `${SITE_URL}/images/logo2.png`,
            orderUrl: `${SITE_URL}/preorder`,
        });
    } catch (error) {
        return failBeforeSend(supabase, claim.id, email, describeCaughtError(error, "Hiba a levél összeállításakor."));
    }

    let providerMessageId: string;
    try {
        const delivery = await send({ to: email, subject: email_.subject, text: email_.text, html: email_.html });
        providerMessageId = delivery.id;
    } catch (error) {
        if (isSmtp2GoUncertainError(error)) {
            return {
                kind: "uncertain",
                email,
                detail: "Az SMTP2GO-hívás eredménye bizonytalan (hálózati hiba/időtúllépés). A rekord 'sending' "
                    + "állapotban maradt, újraküldés NEM indult. Ellenőrizd az SMTP2GO küldési naplóját.",
            };
        }
        return failBeforeSend(supabase, claim.id, email, describeCaughtError(error, "Ismeretlen hiba az SMTP2GO-küldés közben."));
    }

    // A levél már elment: a lezárás hibája NEM lehet failed (újraküldést engedne).
    try {
        await finalizeSeasonLaunchSend(supabase, claim.id, { status: "sent", providerMessageId });
        return { kind: "sent" };
    } catch (finalizeError) {
        console.error(`[season-launch] A sikeres küldés utáni lezárás elhasalt (#${claim.id}):`, finalizeError);
        return {
            kind: "uncertain",
            email,
            detail: `Az SMTP2GO elfogadta a levelet (${providerMessageId}), de a 'sent' lezárás sikertelen volt. `
                + "A rekord 'sending' maradt, újraküldés NEM indult.",
        };
    }
}

// Egy csomag feldolgozása. SOHA nem dob hibát. A guard ITT is érvényesül (nem
// csak a belépési pontban): blokkolt állapotban nincs claim, nincs küldés.
export async function processSeasonLaunchChunk(
    supabase: SupabaseClient,
    season: SeasonLaunchSeason,
    recipients: SeasonLaunchRecipient[],
    runAt: Date,
    deps: SeasonLaunchDeps = {},
): Promise<SeasonLaunchOutcome[]> {
    // Éles útvonalon deps.send üres, ezért a guard megkerülhetetlen.
    if (!deps.send && isSeasonLaunchSendingBlocked(deps.sendingEnabled === true)) {
        return recipients.map(() => ({ kind: "skipped" }));
    }

    const allowed = applyTestRecipientFilter(recipients);
    const send = deps.send ?? sendSmtp2GoEmail;

    return processWithConcurrencyLimit(
        allowed,
        MAX_CONCURRENT_SENDS,
        (recipient) => processRecipient(supabase, season, recipient, runAt, send),
    );
}

function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

// A napi ütemezett feladat belépési pontja (lásd worker/index.ts). A dateIso
// a mai budapesti naptári nap. Blokkolt állapotban SEMMIT nem csinál (még
// adatbázis-lekérdezést sem).
export async function sendSeasonLaunchEmails(
    supabase: SupabaseClient,
    dateIso: string,
    runChunk?: SeasonLaunchChunkRunner,
    deps: SeasonLaunchDeps = {},
): Promise<SeasonLaunchRunResult> {
    const runAt = new Date();
    const result: SeasonLaunchRunResult = {
        blocked: false,
        dateIso,
        seasonIds: [],
        recipientCount: 0,
        sentCount: 0,
        skippedCount: 0,
        failedCount: 0,
        uncertainCount: 0,
        failures: [],
        uncertain: [],
    };

    if (!deps.send && isSeasonLaunchSendingBlocked(deps.sendingEnabled === true)) {
        return { ...result, blocked: true };
    }

    const seasons = await getSeasonsStartingOn(supabase, dateIso, runAt);
    result.seasonIds = seasons.map((season) => season.id);

    if (seasons.length === 0) {
        return result;
    }

    const recipients = await listSeasonLaunchRecipients(supabase);
    result.recipientCount = recipients.length;

    const runner: SeasonLaunchChunkRunner = runChunk
        ?? ((season, group, now) => processSeasonLaunchChunk(supabase, season, group, now, deps));

    for (const season of seasons) {
        const outcomes = (await processWithConcurrencyLimit(
            chunk(recipients, SEASON_LAUNCH_CHUNK_SIZE),
            1,
            async (group) => {
                try {
                    return await runner(season, group, runAt);
                } catch (error) {
                    console.error("[season-launch] Egy csomag feldolgozása elhasalt:", error);
                    // Nem tudjuk, mi ment ki: uncertain, újraküldés NÉLKÜL.
                    return group.map((recipient): SeasonLaunchOutcome => ({
                        kind: "uncertain",
                        email: recipient.email,
                        detail: "A csomag feldolgozója hibával ért véget, az eredmény ismeretlen. Automatikus újraküldés NEM történt.",
                    }));
                }
            },
        )).flat();

        for (const outcome of outcomes) {
            if (outcome.kind === "sent") result.sentCount += 1;
            else if (outcome.kind === "skipped") result.skippedCount += 1;
            else if (outcome.kind === "failed") {
                result.failedCount += 1;
                result.failures.push({ email: outcome.email, errorMessage: outcome.errorMessage });
            } else {
                result.uncertainCount += 1;
                result.uncertain.push({ email: outcome.email, detail: outcome.detail });
            }
        }
    }

    return result;
}
