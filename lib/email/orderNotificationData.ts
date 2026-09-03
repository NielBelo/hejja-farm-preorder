import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    OrderNotificationData,
    OrderNotificationKind,
} from "@/lib/email/orderNotification";

export type OrderLookup =
    | { orderId: number }
    | { orderNumber: string };

type OrderItemRow = {
    quantity: number;
    size_preference: string | null;
    note: string | null;
    products: { name: string } | null;
    packages: { name: string } | null;
};

type OrderRow = {
    public_order_number: string;
    pickup_days: { pickup_date: string } | null;
    current_version: { order_items: OrderItemRow[] } | null;
};

export type LoadedOrderNotification = {
    recipient: string;
    data: OrderNotificationData;
};

const notificationOrderSelect = `
    public_order_number,
    pickup_days!orders_pickup_day_id_fkey (
        pickup_date
    ),
    current_version:order_versions!orders_current_version_id_fkey (
        order_items (
            quantity,
            size_preference,
            note,
            products (name),
            packages (name)
        )
    )
`;

export async function loadOrderNotificationData(
    supabase: SupabaseClient,
    lookup: OrderLookup,
    kind: OrderNotificationKind,
): Promise<LoadedOrderNotification> {
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.email) {
        throw new Error("A rendeléshez tartozó e-mail-cím nem érhető el.");
    }

    let orderQuery = supabase
        .from("orders")
        .select(notificationOrderSelect)
        .eq("user_id", user.id);

    orderQuery = "orderId" in lookup
        ? orderQuery.eq("id", lookup.orderId)
        : orderQuery.eq("public_order_number", lookup.orderNumber);

    const [orderResult, profileResult] = await Promise.all([
        orderQuery.single(),
        supabase
            .from("profiles")
            .select("first_name, last_name")
            .eq("id", user.id)
            .maybeSingle(),
    ]);

    if (orderResult.error || !orderResult.data) {
        throw new Error(
            orderResult.error?.message ?? "A rendelés nem található.",
        );
    }

    if (profileResult.error) {
        throw new Error(profileResult.error.message);
    }

    const order = orderResult.data as unknown as OrderRow;
    const pickupDate = order.pickup_days?.pickup_date;
    const items = order.current_version?.order_items;

    if (!pickupDate || !items) {
        throw new Error("A rendelés értesítési adatai hiányosak.");
    }

    const customerName = [
        profileResult.data?.last_name,
        profileResult.data?.first_name,
    ].filter(Boolean).join(" ").trim() || "Vásárlónk";

    return {
        recipient: user.email,
        data: {
            kind,
            orderNumber: order.public_order_number,
            customerName,
            pickupDate,
            items: items.map((item) => ({
                productName: item.products?.name ?? "Ismeretlen termék",
                packageName: item.packages?.name ?? "Ismeretlen csomagolás",
                quantity: item.quantity,
                sizePreference: item.size_preference,
                note: item.note,
            })),
        },
    };
}
