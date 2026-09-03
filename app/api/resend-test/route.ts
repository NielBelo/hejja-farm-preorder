import {
    EmailConfigurationError,
    EmailDeliveryError,
    sendEmail,
} from "@/lib/email/resend";

const noStoreHeaders = {
    "Cache-Control": "no-store",
};

export async function POST() {
    const recipient = process.env.RESEND_TEST_EMAIL;

    if (!recipient) {
        return Response.json(
            { error: "A RESEND_TEST_EMAIL nincs beállítva." },
            { status: 500, headers: noStoreHeaders },
        );
    }

    try {
        const result = await sendEmail({
            to: recipient,
            subject: "Héjja-Farm – Resend teszt",
            text: "Ez egy egyszerű teszt e-mail a Héjja-Farm Cloudflare Workers alkalmazásából.",
        });

        return Response.json(
            { success: true, id: result.id },
            { headers: noStoreHeaders },
        );
    } catch (error) {
        if (error instanceof EmailConfigurationError) {
            return Response.json(
                { error: error.message },
                { status: 500, headers: noStoreHeaders },
            );
        }

        if (error instanceof EmailDeliveryError) {
            return Response.json(
                { error: error.message },
                { status: 502, headers: noStoreHeaders },
            );
        }

        console.error("Unexpected test email error:", error);
        return Response.json(
            { error: "Váratlan hiba történt a teszt e-mail küldésekor." },
            { status: 500, headers: noStoreHeaders },
        );
    }
}
