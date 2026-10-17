import "server-only";
import {
    classifyEmailType, EMAIL_LOG_PAGE_SIZE, EmailLogError, isAfterBound, mapStatus, matchesFilters, parseTimestamp,
    type EmailLogCursor, type EmailLogRow, type EmailLogStatusFilter, type EmailLogType, type ProviderRows,
} from "./emailLogShared";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const BATCH_SIZE = 100;
// A Resend listában nincs szerveroldali szűrés, ezért szűrt keresésnél legfeljebb ennyi kérést olvasunk végig
// (a legújabb 500 levél); ha addig nincs elég találat, a lista csonkoltnak számít.
const MAX_REQUESTS = 5;
const TIMEOUT_MS = 10_000;
// A (kötelezően egymás utáni) kérések együttes időkerete: ezen túl a lista csonkoltnak számít.
const TOTAL_BUDGET_MS = 15_000;

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

export function toResendRow(item: Record<string, unknown>): EmailLogRow | null {
    const id = text(item.id);
    const t = parseTimestamp(item.created_at);
    if (!id || t === null) return null;
    const rawStatus = text(item.last_event);
    const status = mapStatus("resend", rawStatus);
    const to = Array.isArray(item.to) ? item.to.filter((value): value is string => typeof value === "string").join(", ") : text(item.to);
    return {
        id: `resend:${id}`,
        provider: "resend",
        date: new Date(t).toISOString(),
        t,
        recipient: to,
        subject: text(item.subject),
        emailType: classifyEmailType(text(item.subject)),
        statusLabel: status.label,
        tone: status.tone,
        group: status.group,
        rawStatus,
        detail: null,
    };
}

// A Resend GET /emails a legújabbtól halad, `after` kurzorral. Annyi oldalt olvas, amennyi a megjelenítendő
// oldal + 1 találathoz kell (így a "van következő oldal" eldönthető), és csak a közös kurzor utáni sorokat adja.
export async function fetchResendRows({ recipient, status, type, cursor }: { recipient?: string; status?: EmailLogStatusFilter; type?: EmailLogType; cursor: EmailLogCursor }): Promise<ProviderRows> {
    const apiKey = (process.env.RESEND_READ_API_KEY ?? process.env.RESEND_API_KEY)?.trim();
    if (!apiKey) throw new EmailLogError("A Resend API-kulcs nincs beállítva.", 500);

    const rows: EmailLogRow[] = [];
    let after = cursor.r;
    let hasMore = true;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    for (let request = 0; request < MAX_REQUESTS && hasMore && rows.length <= EMAIL_LOG_PAGE_SIZE && Date.now() < deadline; request++) {
        const params = new URLSearchParams({ limit: String(BATCH_SIZE) });
        if (after) params.set("after", after);

        let response: Response;
        try {
            response = await fetch(`${RESEND_EMAILS_URL}?${params}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
                cache: "no-store",
                signal: AbortSignal.timeout(Math.min(TIMEOUT_MS, Math.max(1, deadline - Date.now()))),
            });
        } catch {
            throw new EmailLogError("A Resend nem válaszolt időben.");
        }

        if (response.status === 429) throw new EmailLogError("A Resend lekérdezési korlátját elértük.", 429);
        if (response.status === 401 || response.status === 403) {
            // Küldésre korlátozott kulcs nem listázhat: teljes hozzáférésű kulcs kell (RESEND_READ_API_KEY).
            throw new EmailLogError("A Resend API-kulcs nem olvashat e-maileket – teljes hozzáférésű kulcs szükséges (RESEND_READ_API_KEY).");
        }
        if (!response.ok) {
            console.error(`[resend] list emails HTTP ${response.status}`);
            throw new EmailLogError(`A Resend hibát adott (HTTP ${response.status}).`);
        }

        let json: { data?: unknown; has_more?: unknown };
        try {
            json = await response.json();
        } catch {
            throw new EmailLogError("A Resend válasza nem értelmezhető.");
        }
        if (!Array.isArray(json.data)) throw new EmailLogError("A Resend válasza nem értelmezhető.");

        for (const item of json.data as Record<string, unknown>[]) {
            const row = toResendRow(item);
            if (row && isAfterBound(row, cursor.g) && matchesFilters(row, { recipient, status, type })) rows.push(row);
        }
        const lastId = text((json.data.at(-1) as Record<string, unknown> | undefined)?.id);
        hasMore = json.has_more === true && lastId !== "";
        after = lastId || after;
    }

    // Ha a kérésplafon miatt álltunk meg, és még lenne további levél, az eredmény csonkolt.
    return { rows, truncated: hasMore && rows.length <= EMAIL_LOG_PAGE_SIZE };
}
