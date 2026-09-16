import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { buildOrderNotification } from "@/lib/email/orderNotification";
import type { OrderNotificationKind } from "@/lib/email/orderNotification";
import {
    loadOrderNotificationData,
    type OrderLookup,
} from "@/lib/email/orderNotificationData";
import { ORDER_EMAIL_LOGO_BASE64 } from "@/lib/email/orderEmailLogo";
import { sendEmail } from "@/lib/email/resend";

type SendOrderNotificationInput = {
    supabase: SupabaseClient;
    lookup: OrderLookup;
    kind: OrderNotificationKind;
    asAdmin?: boolean;
};

async function getRequestOrigin() {
    const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

    if (configuredUrl) {
        return configuredUrl.replace(/\/$/, "");
    }

    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host")?.split(",")[0].trim()
        ?? requestHeaders.get("host")?.trim();

    if (!host) {
        return null;
    }

    const forwardedProtocol = requestHeaders
        .get("x-forwarded-proto")
        ?.split(",")[0]
        .trim();
    const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
        ? forwardedProtocol
        : host.startsWith("localhost")
            ? "http"
            : "https";

    try {
        return new URL(`${protocol}://${host}`).origin;
    } catch {
        return null;
    }
}

export async function sendOrderNotification({
    supabase,
    lookup,
    kind,
    asAdmin,
}: SendOrderNotificationInput) {
    const { recipient, data } = await loadOrderNotificationData(
        supabase,
        lookup,
        kind,
        { asAdmin },
    );
    const origin = await getRequestOrigin();
    const orderAnchor = `order-${data.orderId}`;
    const orderUrl = origin
        ? `${origin}/history?focusOrder=${data.orderId}#${orderAnchor}`
        : undefined;
    const notification = buildOrderNotification(data, {
        logoSrc: "cid:hejja-logo",
        orderUrl,
    });

    const delivery = await sendEmail({
        to: recipient,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        attachments: [{
            content: ORDER_EMAIL_LOGO_BASE64,
            filename: "hejja-okofarm-logo.png",
            content_id: "hejja-logo",
        }],
    });

    return { ...delivery, recipient };
}
