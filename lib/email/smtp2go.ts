import "server-only";

const SMTP2GO_EMAILS_URL = "https://api.smtp2go.com/v3/email/send";
const DEFAULT_FROM = "Héjja Ökofarm <admin@hejja-okofarm.hu>";

// Hibakategóriák a reminder runtime számára:
// - Smtp2GoConfigurationError: a küldés előtt, lokálisan elbukik (pl. nincs API-kulcs) -> failed.
// - Smtp2GoDeliveryError: az SMTP2GO egyértelműen elutasította a küldést -> failed.
// - Smtp2GoUncertainDeliveryError: a kézbesítés eredménye NEM ismert (hálózati hiba,
//   timeout, 5xx, olvashatatlan válasz) -> uncertain, SOHA nem küldhető újra automatikusan.
export class Smtp2GoConfigurationError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoConfigurationError"; } }
export class Smtp2GoDeliveryError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoDeliveryError"; } }
export class Smtp2GoUncertainDeliveryError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoUncertainDeliveryError"; } }

export function isSmtp2GoUncertainError(error: unknown): boolean {
    return error instanceof Smtp2GoUncertainDeliveryError;
}

type Smtp2GoResponseBody = {
    request_id?: string;
    data?: { succeeded?: number; failed?: number; failures?: unknown[]; email_id?: string };
};

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

    let result: Smtp2GoResponseBody;
    try {
        result = await response.json() as Smtp2GoResponseBody;
    } catch {
        // Olvashatatlan válasz: 2xx esetén nem tudjuk, elfogadta-e; 4xx esetén a HTTP státusz már elutasítás.
        if (response.ok) {
            throw new Smtp2GoUncertainDeliveryError("Az SMTP2GO válasza olvashatatlan - a kézbesítés eredménye ismeretlen.");
        }
        throw new Smtp2GoDeliveryError(`Az SMTP2GO elutasította a küldést (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        throw new Smtp2GoDeliveryError(`Az SMTP2GO elutasította a küldést (HTTP ${response.status}).`);
    }

    const succeeded = result.data?.succeeded ?? 0;
    const failed = result.data?.failed ?? 0;

    if (succeeded >= 1) {
        return { id: result.data?.email_id ?? result.request_id ?? "accepted" };
    }

    if (failed > 0) {
        throw new Smtp2GoDeliveryError("Az SMTP2GO egyértelműen elutasította a küldést.");
    }

    // Ismeretlen/hiányos válasz: nem bizonyítható sem az elfogadás, sem az elutasítás.
    throw new Smtp2GoUncertainDeliveryError("Az SMTP2GO válasza nem egyértelmű - a kézbesítés eredménye ismeretlen.");
}
