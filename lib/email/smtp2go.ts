import "server-only";

const SMTP2GO_EMAILS_URL = "https://api.smtp2go.com/v3/email/send";
const DEFAULT_FROM = "Héjja-Farm <admin@hejja-farm.hu>";

export class Smtp2GoConfigurationError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoConfigurationError"; } }
export class Smtp2GoDeliveryError extends Error { constructor(message: string) { super(message); this.name = "Smtp2GoDeliveryError"; } }

export async function sendSmtp2GoEmail({ to, subject, text, html }: { to: string; subject: string; text: string; html: string }) {
    const apiKey = process.env.SMTP2GO_API_KEY;
    if (!apiKey) throw new Smtp2GoConfigurationError("Az SMTP2GO_API_KEY nincs beállítva.");
    try {
        const response = await fetch(SMTP2GO_EMAILS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
            body: JSON.stringify({ sender: process.env.SMTP2GO_FROM_EMAIL?.trim() || DEFAULT_FROM, to: [to], subject, text_body: text, html_body: html, fastaccept: true }),
        });
        const result = await response.json() as { request_id?: string; data?: { succeeded?: number; failed?: number; failures?: unknown[]; email_id?: string } };
        if (!response.ok || ((result.data?.failed ?? 0) > 0 && (result.data?.succeeded ?? 0) === 0)) {
            throw new Smtp2GoDeliveryError("Az SMTP2GO nem fogadta el a meghívó e-mailt.");
        }
        return { id: result.data?.email_id ?? result.request_id ?? "accepted" };
    } catch (error) {
        if (error instanceof Smtp2GoDeliveryError) throw error;
        throw new Smtp2GoDeliveryError("Az SMTP2GO API nem érhető el.");
    }
}
