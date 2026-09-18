"use server";

import { createClient } from "@/lib/supabase/server";
import { sendOrderNotification } from "@/lib/email/sendOrderNotification";
import { normalizePackageId } from "@/lib/orderPackaging";
import { MAX_QUANTITY_PER_ITEM } from "@/lib/orderLimits";

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
    pickupDayId: number;
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

    if (data.items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY_PER_ITEM)) {
        return {
            success: false,
            error: `Egy tételben legfeljebb ${MAX_QUANTITY_PER_ITEM} darab csirke rendelhető.`,
        };
    }

    const productIds = [...new Set(data.items.map((item) => item.product_id))];
    const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds);
    const { data: packages, error: packagesError } = await supabase
        .from("packages")
        .select("id, name");

    if (productsError || packagesError) {
        return {
            success: false,
            error: "A csomagolási beállítások ellenőrzése sikertelen.",
        };
    }

    const normalizedItems = data.items.map((item) => ({
        ...item,
        package_id: normalizePackageId({
            product: products?.find((product) => product.id === item.product_id),
            quantity: item.quantity,
            selectedPackageId: item.package_id,
            packages: packages ?? [],
        }),
    }));

    if (normalizedItems.some((item) => item.package_id === null)) {
        return {
            success: false,
            error: "Az egyedi csomagolás nem található a beállítások között.",
        };
    }

    const { error } = await supabase.rpc("update_order", {
        p_order_id: data.orderId,
        p_items: normalizedItems,
        p_pickup_day_id: data.pickupDayId,
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
        });
        emailRecipient = notification.recipient;
    } catch (notificationError) {
        console.error(
            `Order update email failed for order ${data.orderId}:`,
            notificationError,
        );
        emailWarning =
            "A rendelés módosítása sikeres, de az értesítő e-mailt nem sikerült elküldeni.";
    }

    return { success: true, emailWarning, emailRecipient };
}
