import "server-only";

const SMTP2GO_ACTIVITY_URL = "https://api.smtp2go.com/v3/activity/search";
const HISTORY_DAYS = 5;
const TIMEOUT_MS = 10_000;
export const EMAIL_LOG_PAGE_SIZE = 25;

export type EmailLogTone = "success" | "neutral" | "warning" | "error";
export type EmailLogStatusFilter = "delivered" | "processing" | "bounced" | "rejected";

// SMTP2GO event -> magyar felirat. Az `only_latest` e-mailenként a legfrissebb eseményt adja:
// ha a címzett megnyitotta/kattintott/leiratkozott, a levél korábban már kézbesítve lett.
const statusByEvent: Record<string, { label: string; tone: EmailLogTone }> = {
    processed: { label: "Feldolgozás alatt", tone: "neutral" },
    delivered: { label: "Kézbesítve", tone: "success" },
    opened: { label: "Kézbesítve", tone: "success" },
    clicked: { label: "Kézbesítve", tone: "success" },
    unsubscribed: { label: "Kézbesítve", tone: "success" },
    resubscribed: { label: "Kézbesítve", tone: "success" },
    "soft-bounced": { label: "Ideiglenesen visszapattant", tone: "warning" },
    "hard-bounced": { label: "Visszapattant", tone: "error" },
    rejected: { label: "Elutasítva", tone: "error" },
    spam: { label: "Spamnek jelölve", tone: "error" },
};

export const statusFilterEvents: Record<EmailLogStatusFilter, string[]> = {
    delivered: ["delivered", "opened", "clicked", "unsubscribed", "resubscribed"],
    processing: ["processed"],
    bounced: ["soft-bounced", "hard-bounced"],
    rejected: ["rejected", "spam"],
};

export function isEmailLogStatusFilter(value: string): value is EmailLogStatusFilter {
    return Object.hasOwn(statusFilterEvents, value);
}

export type EmailLogRow = { id: string; date: string; recipient: string; subject: string; statusLabel: string; tone: EmailLogTone; detail: string | null };
export type EmailLogPage = { rows: EmailLogRow[]; total: number; nextToken: string | null };

export class EmailLogError extends Error {
    constructor(message: string, readonly status = 502) { super(message); this.name = "EmailLogError"; }
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

// Egy SMTP2GO esemény sorrá alakítása. Ismeretlen eseménynél nem találgat.
export function toEmailLogRow(event: Record<string, unknown>): EmailLogRow | null {
    const date = text(event.date);
    if (!date) return null;
    const known = statusByEvent[text(event.event)];
    const detail = text(event.reason) || text(event.smtp_response) || text(event.error) || null;
    return {
        id: `${text(event.email_id)}-${date}`,
        date,
        recipient: text(event.recipient) || text(event.to),
        subject: text(event.subject),
        statusLabel: known?.label ?? "Ismeretlen állapot",
        tone: known?.tone ?? "neutral",
        detail: known && (known.tone === "error" || known.tone === "warning") ? detail : null,
    };
}

export async function searchEmailLog({ recipient, status, token }: { recipient?: string; status?: EmailLogStatusFilter; token?: string }): Promise<EmailLogPage> {
    const apiKey = process.env.SMTP2GO_API_KEY?.trim();
    if (!apiKey) throw new EmailLogError("Az SMTP2GO_API_KEY nincs beállítva.", 500);

    // A continue_token ugyanazokkal a paraméterekkel folytatja a keresést.
    const body: Record<string, unknown> = {
        limit: EMAIL_LOG_PAGE_SIZE,
        only_latest: true,
        start_date: new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString(),
        ...(recipient ? { search_recipient: recipient } : {}),
        ...(status ? { event_types: statusFilterEvents[status] } : {}),
        ...(token ? { continue_token: token } : {}),
    };

    let response: Response;
    try {
        response = await fetch(SMTP2GO_ACTIVITY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
            body: JSON.stringify(body),
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new EmailLogError("Az SMTP2GO nem válaszolt időben. Próbálja újra később.");
    }

    if (response.status === 429) throw new EmailLogError("Az SMTP2GO lekérdezési korlátját elértük. Várjon egy percet, majd frissítsen.", 429);
    if (!response.ok) {
        console.error(`[smtp2go] activity/search HTTP ${response.status}`);
        throw new EmailLogError(`Az SMTP2GO hibát adott (HTTP ${response.status}).`);
    }

    let json: { data?: { events?: unknown; total_events?: unknown; continue_token?: unknown } };
    try {
        json = await response.json();
    } catch {
        throw new EmailLogError("Az SMTP2GO válasza nem értelmezhető.");
    }
    const events = json.data?.events;
    if (!Array.isArray(events)) throw new EmailLogError("Az SMTP2GO válasza nem értelmezhető.");

    const rows = events
        .map((event) => toEmailLogRow(event as Record<string, unknown>))
        .filter((row): row is EmailLogRow => row !== null)
        .sort((a, b) => b.date.localeCompare(a.date));
    const nextToken = typeof json.data?.continue_token === "string" && json.data.continue_token ? json.data.continue_token : null;
    return { rows, total: Number(json.data?.total_events) || rows.length, nextToken };
}
