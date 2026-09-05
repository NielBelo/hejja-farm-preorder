"use server";

import { sendOrderNotification } from "@/lib/email/sendOrderNotification";
import { createClient } from "@/lib/supabase/server";

export type AdminUpdateOrderItem = {
    product_id: number;
    package_id: number;
    quantity: number;
    size_preference: string;
    note: string;
};

type AdminUpdateOrderData = {
    orderId: number;
    items: AdminUpdateOrderItem[];
};

export async function updateAdminOrder(data: AdminUpdateOrderData) {
    const supabase = await createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return {
            success: false,
            error: "Nincs bejelentkezett felhasználó.",
        };
    }

    const { data: adminRole, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

    if (roleError || !adminRole) {
        return {
            success: false,
            error: "A művelethez adminisztrátori jogosultság szükséges.",
        };
    }

    const { error } = await supabase.rpc("update_order", {
        p_order_id: data.orderId,
        p_items: data.items,
    });

    if (error) {
        return {
            success: false,
            error: error.message,
        };
    }

    let emailWarning: string | undefined;
    let emailRecipient: string | undefined;

    try {
        const notification = await sendOrderNotification({
            supabase,
            lookup: { orderId: data.orderId },
            kind: "updated",
            asAdmin: true,
        });
        emailRecipient = notification.recipient;
    } catch (notificationError) {
        console.error(
            `Admin order update email failed for order ${data.orderId}:`,
            notificationError,
        );
        emailWarning =
            "A rendelés módosítása sikeres, de az értesítő e-mailt nem sikerült elküldeni.";
    }

    return { success: true, emailWarning, emailRecipient };
}
