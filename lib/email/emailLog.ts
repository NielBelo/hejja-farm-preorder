import "server-only";
import { buildPage, EmailLogError, matchesFilters, type EmailLogCursor, type EmailLogPage, type EmailLogRow, type EmailLogStatusFilter, type EmailLogType, type EmailProvider, type ProviderRows, providerLabels } from "./emailLogShared";
import { fetchSmtp2GoRows, SMTP2GO_HISTORY_DAYS } from "./smtp2goActivity";
import { fetchResendRows } from "./resendActivity";

// A két szolgáltató egymástól függetlenül kérdezhető le: ha az egyik hibázik, a másik sorai megjelennek,
// és figyelmeztetés jelzi, hogy a lista hiányos.
export async function searchEmailLog({ recipient, status, type, provider, cursor }: {
    recipient?: string;
    status?: EmailLogStatusFilter;
    type?: EmailLogType;
    provider?: EmailProvider;
    cursor: EmailLogCursor;
}): Promise<EmailLogPage> {
    const sources: Array<[EmailProvider, Promise<ProviderRows>]> = [];
    // Ha a kurzor már az SMTP2GO előzményablakán kívül jár, ott nem lehet további találat: a hívás kihagyható.
    const smtpHasOlderRows = !cursor.g || cursor.g.t > Date.now() - SMTP2GO_HISTORY_DAYS * 86_400_000;
    if (provider !== "resend" && smtpHasOlderRows) sources.push(["smtp2go", fetchSmtp2GoRows({ recipient })]);
    if (provider !== "smtp2go") sources.push(["resend", fetchResendRows({ recipient, status, type, cursor })]);

    const settled = await Promise.allSettled(sources.map(([, promise]) => promise));
    const rows: EmailLogRow[] = [];
    const warnings: string[] = [];
    let firstError: EmailLogError | null = null;

    settled.forEach((result, index) => {
        const name = providerLabels[sources[index][0]];
        if (result.status === "rejected") {
            const error = result.reason instanceof EmailLogError ? result.reason : new EmailLogError("Ismeretlen hiba.", 500);
            if (!(result.reason instanceof EmailLogError)) console.error(`[email-log] ${name} lekérdezés hiba:`, result.reason);
            firstError ??= error;
            warnings.push(`${name}: ${error.message} A lista hiányos.`);
            return;
        }
        if (result.value.truncated) warnings.push(`${name}: a találatok csonkolva vannak (legfeljebb a legújabb levelek láthatók). A lista hiányos lehet.`);
        // A Resend sorait a lekérdezés már szűrte; az SMTP2GO-nál a szűrés (állapot, típus) itt történik.
        const matching = sources[index][0] === "smtp2go" ? result.value.rows.filter((row) => matchesFilters(row, { recipient, status, type })) : result.value.rows;
        rows.push(...matching);
    });

    // Csak akkor hiba az egész oldal, ha egyik lekérdezett szolgáltató sem válaszolt.
    if (firstError && settled.every((result) => result.status === "rejected")) throw firstError;
    return buildPage(rows, cursor, warnings);
}
