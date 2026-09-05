import "server-only";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Héjja-Farm <rendeles@hejja-farm.hu>";

type SendEmailInput = {
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{
        path?: string;
        content?: string;
        filename: string;
        content_id: string;
    }>;
};

type ResendResponse = {
    id?: string;
    message?: string;
};

export class EmailConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmailConfigurationError";
    }
}

export class EmailDeliveryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "EmailDeliveryError";
    }
}

export async function sendEmail({
    to,
    subject,
    text,
    html,
    attachments,
}: SendEmailInput) {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
        throw new EmailConfigurationError("A RESEND_API_KEY nincs beállítva.");
    }

    try {
        const response = await fetch(RESEND_EMAILS_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: DEFAULT_FROM,
                to: [to],
                subject,
                text,
                html,
                attachments,
            }),
        });

        const result = (await response.json()) as ResendResponse;

        if (!response.ok || !result.id) {
            console.error("Resend email delivery failed:", result.message ?? response.status);
            throw new EmailDeliveryError("A Resend nem fogadta el az e-mailt.");
        }

        return { id: result.id };
    } catch (error) {
        if (error instanceof EmailDeliveryError) {
            throw error;
        }

        console.error("Resend email request failed:", error);
        throw new EmailDeliveryError("A Resend API nem érhető el.");
    }
}
