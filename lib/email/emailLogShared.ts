// A két szolgáltató (SMTP2GO, Resend) e-mail-naplójának közös típusai, státuszleképezése és
// összefésülése. Szándékosan nincs "server-only": a kliens is importálja a típusokat/címkéket.

export const EMAIL_LOG_PAGE_SIZE = 25;

export type EmailProvider = "smtp2go" | "resend";
export type EmailLogTone = "success" | "neutral" | "warning" | "error";
export type EmailLogStatusFilter = "delivered" | "processing" | "bounced" | "rejected" | "spam";

export const providerLabels: Record<EmailProvider, string> = { smtp2go: "SMTP2GO", resend: "Resend" };
export const statusFilterLabels: Record<EmailLogStatusFilter, string> = {
    delivered: "Kézbesítve",
    processing: "Feldolgozás alatt / elküldve",
    bounced: "Késleltetve / visszapattant",
    rejected: "Elutasítva / sikertelen",
    spam: "Spamnek jelölve",
};

export type EmailLogType = "new_order" | "order_updated" | "order_cancelled" | "invite" | "confirmation" | "reminder" | "other";
export const emailTypeLabels: Record<EmailLogType, string> = {
    new_order: "Új rendelés",
    order_updated: "Rendelés módosítása",
    order_cancelled: "Rendelés törlése",
    invite: "Regisztrációs meghívó",
    confirmation: "E-mail megerősítés",
    reminder: "Átvételi emlékeztető",
    other: "Egyéb",
};
export function isEmailLogType(value: string): value is EmailLogType {
    return Object.hasOwn(emailTypeLabels, value);
}

// A levéltípus a tényleges tárgyból következik (a küldő szolgáltatótól független). A sablonok tárgya:
// "<márka> – <típusszöveg>[ (<változó adat, pl. rendelésszám>)]". A márkaelőtag történetileg változott
// ("Héjja Ökofarm", "Héjja-Farm", "Héjja-Ökofarm"), ezért csak a "Héjja" kezdetet várjuk el, a típus pedig a
// kötőjel utáni szöveg ELEJÉRE-VÉGÉRE illesztett minta – így pl. az admin "emlékeztető futás összesítő" levél
// nem számít átvételi emlékeztetőnek. Ami semmire nem illik: "other".
const typePatterns: Array<[RegExp, EmailLogType]> = [
    [/^rendelés visszaigazolása(?: \(.*\))?$/, "new_order"],
    [/^rendelés módosítva(?: \(.*\))?$/, "order_updated"],
    [/^rendelés törölve(?: \(.*\))?$/, "order_cancelled"],
    [/^meghívó csirke előrendeléshez$/, "invite"],
    [/^erősítsd meg az e-mail-címedet$/, "confirmation"],
    [/^rendelés átvételi emlékeztető(?: \(.*\))?$/, "reminder"],
];
export function classifyEmailType(subject: string): EmailLogType {
    const normalized = subject.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("hu");
    const parts = normalized.split(/ [–—-] /);
    if (parts.length < 2 || !parts[0].startsWith("héjja")) return "other";
    const rest = parts.slice(1).join(" – ");
    return typePatterns.find(([pattern]) => pattern.test(rest))?.[1] ?? "other";
}

export function isEmailProvider(value: string): value is EmailProvider {
    return Object.hasOwn(providerLabels, value);
}
export function isEmailLogStatusFilter(value: string): value is EmailLogStatusFilter {
    return Object.hasOwn(statusFilterLabels, value);
}

type MappedStatus = { label: string; tone: EmailLogTone; group: EmailLogStatusFilter };

const delivered: MappedStatus = { label: "Kézbesítve", tone: "success", group: "delivered" };
const spam: MappedStatus = { label: "Spamnek jelölve", tone: "error", group: "spam" };

// SMTP2GO: az `only_latest` e-mailenként a legfrissebb eseményt adja. Megnyitás/kattintás/leiratkozás
// csak kézbesített levélnél lehetséges.
const smtp2goStatuses: Record<string, MappedStatus> = {
    processed: { label: "Feldolgozás alatt", tone: "neutral", group: "processing" },
    delivered,
    opened: delivered,
    clicked: delivered,
    unsubscribed: delivered,
    resubscribed: delivered,
    "soft-bounced": { label: "Ideiglenesen visszapattant", tone: "warning", group: "bounced" },
    "hard-bounced": { label: "Visszapattant", tone: "error", group: "bounced" },
    rejected: { label: "Elutasítva", tone: "error", group: "rejected" },
    spam,
};

// Resend `last_event`. A sent/queued/scheduled NEM kézbesítés; az opened/clicked kézbesítést feltételez;
// a complained kézbesített, de spamnek jelölt levél (nem sikertelen kézbesítés).
const resendStatuses: Record<string, MappedStatus> = {
    queued: { label: "Feldolgozás alatt", tone: "neutral", group: "processing" },
    scheduled: { label: "Ütemezve", tone: "neutral", group: "processing" },
    sent: { label: "Elküldve", tone: "neutral", group: "processing" },
    delivered,
    opened: delivered,
    clicked: delivered,
    delivery_delayed: { label: "Késleltetve", tone: "warning", group: "bounced" },
    bounced: { label: "Visszapattant", tone: "error", group: "bounced" },
    failed: { label: "Sikertelen", tone: "error", group: "rejected" },
    suppressed: { label: "Elutasítva (tiltólistán)", tone: "error", group: "rejected" },
    complained: spam,
};

export type EmailLogRow = {
    id: string;
    provider: EmailProvider;
    date: string;
    t: number;
    recipient: string;
    subject: string;
    statusLabel: string;
    tone: EmailLogTone;
    group: EmailLogStatusFilter | null;
    emailType: EmailLogType;
    // A szolgáltató eredeti státusza/eseménye (az egységesítés nem veszíti el).
    rawStatus: string;
    detail: string | null;
};

export function mapStatus(provider: EmailProvider, rawStatus: string): { label: string; tone: EmailLogTone; group: EmailLogStatusFilter | null } {
    const known = (provider === "smtp2go" ? smtp2goStatuses : resendStatuses)[rawStatus];
    if (known) return known;
    return { label: rawStatus ? `Egyéb (${rawStatus})` : "Egyéb", tone: "neutral", group: null };
}

// SMTP2GO: "2026-10-14T22:36:37Z"; Resend: Postgres-stílusú "2026-10-14 22:36:37.123456+00" is lehet.
export function parseTimestamp(value: unknown): number | null {
    if (typeof value !== "string" || !value) return null;
    let parsed = Date.parse(value);
    if (Number.isNaN(parsed)) parsed = Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    return Number.isNaN(parsed) ? null : parsed;
}

export function matchesFilters(row: EmailLogRow, { recipient, status, type }: { recipient?: string; status?: EmailLogStatusFilter; type?: EmailLogType }): boolean {
    if (status && row.group !== status) return false;
    if (type && row.emailType !== type) return false;
    if (recipient && !row.recipient.toLowerCase().includes(recipient.toLowerCase())) return false;
    return true;
}

// Közös rendezés: legújabb elöl, azonos időpontnál az id szerint csökkenő (determinisztikus).
export function compareRows(a: EmailLogRow, b: EmailLogRow): number {
    return b.t - a.t || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

// Az oldal kurzora: g = az utoljára megjelenített sor (a közös sorrendben), r = az utolsó megjelenített
// Resend levél id-ja (a Resend `after` paramétere, hogy ne kelljen elölről végigolvasni).
export type EmailLogCursor = { g: { t: number; id: string } | null; r: string | null };

export function isAfterBound(row: EmailLogRow, bound: EmailLogCursor["g"]): boolean {
    return !bound || row.t < bound.t || (row.t === bound.t && row.id < bound.id);
}

export function encodeCursor(cursor: EmailLogCursor): string {
    return JSON.stringify(cursor);
}

export function decodeCursor(token: string | undefined): EmailLogCursor | null {
    if (!token) return { g: null, r: null };
    if (token.length > 1000) return null;
    try {
        const value = JSON.parse(token) as { g?: { t?: unknown; id?: unknown } | null; r?: unknown };
        const g = value.g;
        if (g !== null && g !== undefined && (typeof g.t !== "number" || !Number.isFinite(g.t) || typeof g.id !== "string")) return null;
        if (value.r !== null && value.r !== undefined && typeof value.r !== "string") return null;
        return { g: g ? { t: g.t as number, id: g.id as string } : null, r: (value.r as string | null | undefined) ?? null };
    } catch {
        return null;
    }
}

export type EmailLogPage = { rows: EmailLogRow[]; nextToken: string | null; warnings: string[] };

// Összefésülés: közös rendezés, a kurzor utáni sorok, egy oldalnyi eredmény + a következő kurzor.
export function buildPage(rows: EmailLogRow[], cursor: EmailLogCursor, warnings: string[], pageSize = EMAIL_LOG_PAGE_SIZE): EmailLogPage {
    const merged = rows.filter((row) => isAfterBound(row, cursor.g)).sort(compareRows);
    const pageRows = merged.slice(0, pageSize);
    const last = pageRows.at(-1);
    const lastResend = [...pageRows].reverse().find((row) => row.provider === "resend");
    const nextToken = merged.length > pageSize && last
        ? encodeCursor({ g: { t: last.t, id: last.id }, r: lastResend ? lastResend.id.slice("resend:".length) : cursor.r })
        : null;
    return { rows: pageRows, nextToken, warnings };
}

export class EmailLogError extends Error {
    constructor(message: string, readonly status = 502) { super(message); this.name = "EmailLogError"; }
}

export type ProviderRows = { rows: EmailLogRow[]; truncated: boolean };
