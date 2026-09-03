"use server";

import { createClient } from "@/lib/supabase/server";
import { sendOrderNotification } from "@/lib/email/sendOrderNotification";

export type UpdateOrderItem = {
    product_id: number;
    package_id: number;
    quantity: number;
    size_preference: string;
    note: string;
};

type UpdateOrderData = {
    orderId: number;
    items: UpdateOrderItem[];
};

export async function updateOrder(data: UpdateOrderData) {
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

    try {
        await sendOrderNotification({
            supabase,
            lookup: { orderId: data.orderId },
            kind: "updated",
        });
    } catch (notificationError) {
        console.error(
            `Order update email failed for order ${data.orderId}:`,
            notificationError,
        );
        emailWarning =
            "A rendelés módosítása sikeres, de az értesítő e-mailt nem sikerült elküldeni.";
    }

    return { success: true, emailWarning };
}
