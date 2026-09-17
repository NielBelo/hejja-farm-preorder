"use server";

import { revalidatePath } from "next/cache";
import { buildRegistrationInvite } from "@/lib/email/registrationInvite";
import { sendSmtp2GoEmail, Smtp2GoConfigurationError, Smtp2GoDeliveryError } from "@/lib/email/smtp2go";
import { createClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const siteUrl = "https://hejja-okofarm.hu";

export type InviteBatchResult = {
    success: boolean;
    sent: string[];
    failed: Array<{ email: string; error: string }>;
    error?: string;
};

type InviteRecipient = { email: string; recipientName?: string };

function parseRecipients(rawEmails: string): InviteRecipient[] | { error: string } {
    const recipients = new Map<string, InviteRecipient>();
    for (const rawLine of rawEmails.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const [rawEmail, ...rawName] = line.split(";");
        const email = rawEmail.trim().toLowerCase();
        const recipientName = rawName.join(";").trim() || undefined;
        if (!emailPattern.test(email)) return { error: `Érvénytelen e-mail-cím: ${rawEmail.trim()}` };
        if (recipientName && recipientName.length > 100) return { error: `A keresztnév legfeljebb 100 karakter lehet: ${email}` };
        if (!recipients.has(email)) recipients.set(email, { email, recipientName });
    }
    return [...recipients.values()];
}

export async function sendRegistrationInvites(rawEmails: string): Promise<InviteBatchResult> {
    const parsedRecipients = parseRecipients(rawEmails);
    if ("error" in parsedRecipients) return { success: false, sent: [], failed: [], error: parsedRecipients.error };
    if (!parsedRecipients.length) return { success: false, sent: [], failed: [], error: "Adjon meg legalább egy e-mail-címet." };
    if (parsedRecipients.length > 100) return { success: false, sent: [], failed: [], error: "Egy küldésben legfeljebb 100 meghívó adható fel." };
    if (!process.env.SMTP2GO_API_KEY) return { success: false, sent: [], failed: [], error: "Az SMTP2GO_API_KEY nincs beállítva." };

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false, sent: [], failed: [], error: "A küldéshez jelentkezzen be újra." };
    const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (roleError || !role) return { success: false, sent: [], failed: [], error: "Adminisztrátori jogosultság szükséges." };

    const sent: string[] = [];
    const failed: InviteBatchResult["failed"] = [];

    async function sendOne({ email, recipientName }: InviteRecipient) {
        const { data: inviteRows, error: inviteError } = await supabase.rpc("admin_create_registration_invite", { invitee_email: email });
        const invite = Array.isArray(inviteRows) ? inviteRows[0] as { invite_id?: string; invite_token?: string } | undefined : undefined;
        if (inviteError || !invite?.invite_id || !invite.invite_token) {
            failed.push({ email, error: "A meghívó létrehozása sikertelen." });
            return;
        }
        const message = buildRegistrationInvite({ recipientName, invitationUrl: `${siteUrl}/register?invite=${encodeURIComponent(invite.invite_token)}` });
        try {
            await sendSmtp2GoEmail({ to: email, subject: message.subject, text: message.text, html: message.html });
            const { error: markedError } = await supabase.rpc("admin_mark_registration_invite_sent", { target_invite_id: invite.invite_id });
            if (markedError) throw new Error("A kiküldés naplózása sikertelen.");
            sent.push(email);
        } catch (error) {
            const message = error instanceof Smtp2GoConfigurationError || error instanceof Smtp2GoDeliveryError || error instanceof Error
                ? error.message : "A meghívó e-mail küldése sikertelen.";
            failed.push({ email, error: message });
        }
    }

    // Korlátozott párhuzamossággal küldjük a meghívókat, hogy nagy listánál
    // (akár 100 címzett) ne fusson bele a Cloudflare Workers kérés-időkorlátjába
    // a szekvenciálisan összeadódó várakozási idő.
    const CONCURRENCY = 10;
    for (let i = 0; i < parsedRecipients.length; i += CONCURRENCY) {
        await Promise.all(parsedRecipients.slice(i, i + CONCURRENCY).map(sendOne));
    }

    revalidatePath("/admin/accounts");
    return { success: failed.length === 0, sent, failed };
}
