import "server-only";
import { classifyEmailType, EmailLogError, mapStatus, parseTimestamp, type EmailLogRow, type ProviderRows } from "./emailLogShared";

const SMTP2GO_ACTIVITY_URL = "https://api.smtp2go.com/v3/activity/search";
// Az SMTP2GO ingyenes csomagja 5 napos aktivitási előzményt őriz.
export const SMTP2GO_HISTORY_DAYS = 5;
// Az 5 napos előzmény egyetlen kéréssel (az API maximuma) lekérhető; ennél több e-mail esetén jelezzük a csonkolást.
const MAX_EVENTS = 1000;
const TIMEOUT_MS = 10_000;

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

// Egy SMTP2GO esemény sorrá alakítása. Ismeretlen eseménynél nem találgat.
export function toEmailLogRow(event: Record<string, unknown>): EmailLogRow | null {
    const t = parseTimestamp(event.date);
    const emailId = text(event.email_id);
    if (t === null || !emailId) return null;
    const rawStatus = text(event.event);
    const status = mapStatus("smtp2go", rawStatus);
    const detail = text(event.reason) || text(event.smtp_response) || text(event.error) || null;
    return {
        id: `smtp2go:${emailId}`,
        provider: "smtp2go",
        date: new Date(t).toISOString(),
        t,
        recipient: text(event.recipient) || text(event.to),
        subject: text(event.subject),
        emailType: classifyEmailType(text(event.subject)),
        statusLabel: status.label,
        tone: status.tone,
        group: status.group,
        rawStatus,
        detail: status.tone === "error" || status.tone === "warning" ? detail : null,
    };
}

// E-mailenként a legfrissebb esemény (only_latest) az elmúlt 5 napból. A státusz szerinti szűrés a
// legfrissebb eseményre közösen, az összefésülés előtt történik.
export async function fetchSmtp2GoRows({ recipient }: { recipient?: string }): Promise<ProviderRows> {
    const apiKey = process.env.SMTP2GO_API_KEY?.trim();
    if (!apiKey) throw new EmailLogError("Az SMTP2GO_API_KEY nincs beállítva.", 500);

    let response: Response;
    try {
        response = await fetch(SMTP2GO_ACTIVITY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
            body: JSON.stringify({
                limit: MAX_EVENTS,
                only_latest: true,
                start_date: new Date(Date.now() - SMTP2GO_HISTORY_DAYS * 86_400_000).toISOString(),
                ...(recipient ? { search_recipient: recipient } : {}),
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new EmailLogError("Az SMTP2GO nem válaszolt időben.");
    }

    if (response.status === 429) throw new EmailLogError("Az SMTP2GO lekérdezési korlátját elértük.", 429);
    if (!response.ok) {
        console.error(`[smtp2go] activity/search HTTP ${response.status}`);
        throw new EmailLogError(`Az SMTP2GO hibát adott (HTTP ${response.status}).`);
    }

    let json: { data?: { events?: unknown; continue_token?: unknown } };
    try {
        json = await response.json();
    } catch {
        throw new EmailLogError("Az SMTP2GO válasza nem értelmezhető.");
    }
    const events = json.data?.events;
    if (!Array.isArray(events)) throw new EmailLogError("Az SMTP2GO válasza nem értelmezhető.");

    return {
        rows: events.map((event) => toEmailLogRow(event as Record<string, unknown>)).filter((row): row is EmailLogRow => row !== null),
        truncated: typeof json.data?.continue_token === "string" && json.data.continue_token !== "",
    };
}
