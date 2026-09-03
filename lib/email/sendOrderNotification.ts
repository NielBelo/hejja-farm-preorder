import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderNotification } from "@/lib/email/orderNotification";
import type { OrderNotificationKind } from "@/lib/email/orderNotification";
import {
    loadOrderNotificationData,
    type OrderLookup,
} from "@/lib/email/orderNotificationData";
import { sendEmail } from "@/lib/email/resend";

type SendOrderNotificationInput = {
    supabase: SupabaseClient;
    lookup: OrderLookup;
    kind: OrderNotificationKind;
};

export async function sendOrderNotification({
    supabase,
    lookup,
    kind,
}: SendOrderNotificationInput) {
    const { recipient, data } = await loadOrderNotificationData(
        supabase,
        lookup,
        kind,
    );
    const notification = buildOrderNotification(data);

    return sendEmail({
        to: recipient,
        subject: notification.subject,
        text: notification.text,
    });
}
