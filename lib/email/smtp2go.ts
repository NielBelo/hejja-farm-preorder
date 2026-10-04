import "server-only";

const SMTP2GO_EMAILS_URL = "https://api.smtp2go.com/v3/email/send";
const DEFAULT_FROM = "Héjja Ökofarm <admin@hejja-okofarm.hu>";

// Hibakategóriák:
// - Smtp2GoConfigurationError: a küldés előtt, lokálisan elbukik (pl. nincs API-kulcs) -> failed.
// - Smtp2GoDeliveryError: az SMTP2GO egyértelműen elutasította a küldést -> failed.
// - Smtp2GoUncertainDeliveryError: a kézbesítés eredménye NEM ismert (hálózati hiba,
//   timeout, 5xx, olvashatatlan vagy értelmezhetetlen válasz) -> uncertain, SOHA nem
//   küldhető újra automatikusan.
export class Smtp2GoConfigurationError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoConfigurationError"; } }
export class Smtp2GoDeliveryError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoDeliveryError"; } }
export class Smtp2GoUncertainDeliveryError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoUncertainDeliveryError"; } }

export function isSmtp2GoUncertainError(error: unknown): boolean {
    return error instanceof Smtp2GoUncertainDeliveryError;
}

export type Smtp2GoInterpretation =
    | { kind: "accepted"; id: string }
    | { kind: "rejected" }
    | { kind: "uncertain"; shape: string };

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readCount(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function readId(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

// Csak kulcsneveket ír le (értékeket, címzetteket nem), hogy egy ismeretlen
// válasz naplóból is diagnosztizálható legyen.
function describeShape(body: unknown): string {
    const top = asRecord(body);
    const data = asRecord(top?.data);
    return `top=[${top ? Object.keys(top).join(",") : typeof body}] data=[${data ? Object.keys(data).join(",") : "nincs"}]`;
}

// Egy már sikeresen olvasott HTTP-válasz értelmezése (tiszta függvény, a tesztek is ezt használják).
// Megfigyelt sikeres válasz fastaccept: true mellett (kontrollált próba):
//   { "request_id": "...", "data": { "email_id": "..." } }  HTTP 200
// Ebben NINCS data.succeeded / data.failed, ezért a data.email_id a fő sikerjelzés.
// - 2xx + data.email_id + nincs hiba -> elfogadva (provider_message_id = data.email_id)
// - data.succeeded >= 1 -> elfogadva
// - explicit data.error / top-level error, vagy 4xx -> elutasítva
// - data.failed > 0 és nincs siker -> elutasítva
// - 5xx, hálózati hiba, timeout, értelmezhetetlen 2xx -> uncertain
// A top-level request_id SOHA nem jelent sikert: önmagában uncertain marad.
export function interpretSmtp2GoResponse(httpStatus: number, body: unknown): Smtp2GoInterpretation {
    if (httpStatus >= 500) {
        return { kind: "uncertain", shape: `http=${httpStatus}` };
    }
    if (httpStatus < 200 || httpStatus >= 300) {
        return { kind: "rejected" };
    }

    const top = asRecord(body);
    if (!top) {
        return { kind: "uncertain", shape: describeShape(body) };
    }

    const data = asRecord(top.data) ?? {};
    const succeeded = readCount(data.succeeded);
    const failed = readCount(data.failed);
    const emailId = readId(data.email_id);
    const hasExplicitError = top.error !== undefined && top.error !== null || data.error !== undefined && data.error !== null;

    if (succeeded >= 1) {
        return { kind: "accepted", id: emailId ?? "accepted" };
    }
    if (failed > 0 || hasExplicitError) {
        return { kind: "rejected" };
    }
    if (emailId) {
        return { kind: "accepted", id: emailId };
    }
    return { kind: "uncertain", shape: describeShape(body) };
}

export async function sendSmtp2GoEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }) {
    const apiKey = process.env.SMTP2GO_API_KEY;
    if (!apiKey) throw new Smtp2GoConfigurationError("Az SMTP2GO_API_KEY nincs beállítva.");

    let response: Response;
    try {
        response = await fetch(SMTP2GO_EMAILS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
            body: JSON.stringify({ sender: process.env.SMTP2GO_FROM_EMAIL?.trim() || DEFAULT_FROM, to: [to], subject, text_body: text, html_body: html, fastaccept: true }),
        });
    } catch {
        // Kapcsolat megszakadt / timeout: lehet, hogy a provider már elfogadta a levelet.
        throw new Smtp2GoUncertainDeliveryError("Az SMTP2GO API nem érhető el - a kézbesítés eredménye ismeretlen.");
    }

    if (response.status >= 500) {
        throw new Smtp2GoUncertainDeliveryError(`Az SMTP2GO szerverhibát adott (HTTP ${response.status}) - a kézbesítés eredménye ismeretlen.`);
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        // Olvashatatlan válasz: 2xx esetén nem tudjuk, elfogadta-e; 4xx esetén a HTTP státusz már elutasítás.
        if (response.ok) {
            throw new Smtp2GoUncertainDeliveryError("Az SMTP2GO válasza olvashatatlan - a kézbesítés eredménye ismeretlen.");
        }
        throw new Smtp2GoDeliveryError(`Az SMTP2GO elutasította a küldést (HTTP ${response.status}).`);
    }

    const interpreted = interpretSmtp2GoResponse(response.status, body);
    if (interpreted.kind === "accepted") {
        return { id: interpreted.id };
    }
    if (interpreted.kind === "rejected") {
        throw new Smtp2GoDeliveryError(`Az SMTP2GO egyértelműen elutasította a küldést (HTTP ${response.status}).`);
    }

    console.warn(`[smtp2go] Nem értelmezhető válasz (HTTP ${response.status}): ${interpreted.shape}`);
    throw new Smtp2GoUncertainDeliveryError("Az SMTP2GO válasza nem egyértelmű - a kézbesítés eredménye ismeretlen.");
}
