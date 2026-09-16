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
    id: number;
    user_id: string;
    season_parameter_id: number;
    public_order_number: string;
    pickup_days: { pickup_date: string } | null;
    current_version: { order_items: OrderItemRow[] } | null;
};

export type LoadedOrderNotification = {
    recipient: string;
    data: OrderNotificationData;
};

const notificationOrderSelect = `
    id,
    user_id,
    season_parameter_id,
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
    options: { asAdmin?: boolean } = {},
): Promise<LoadedOrderNotification> {
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        throw new Error("A rendeléshez tartozó e-mail-cím nem érhető el.");
    }

    if (options.asAdmin) {
        const { data: adminRole, error: roleError } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();

        if (roleError || !adminRole) {
            throw new Error("Az adminisztrátori jogosultság nem ellenőrizhető.");
        }
    } else if (!user.email) {
        throw new Error("A rendeléshez tartozó e-mail-cím nem érhető el.");
    }

    let orderQuery = supabase
        .from("orders")
        .select(notificationOrderSelect);

    if (!options.asAdmin) {
        orderQuery = orderQuery.eq("user_id", user.id);
    }

    orderQuery = "orderId" in lookup
        ? orderQuery.eq("id", lookup.orderId)
        : orderQuery.eq("public_order_number", lookup.orderNumber);

    const orderResult = await orderQuery.single();

    if (orderResult.error || !orderResult.data) {
        throw new Error(
            orderResult.error?.message ?? "A rendelés nem található.",
        );
    }

    const order = orderResult.data as unknown as OrderRow;
    const [profileResult, seasonResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("first_name, last_name, email")
            .eq("id", order.user_id)
            .maybeSingle(),
        supabase
            .from("season_parameters")
            .select("time_window_start, time_window_end")
            .eq("id", order.season_parameter_id)
            .single(),
    ]);

    if (profileResult.error) {
        throw new Error(profileResult.error.message);
    }

    const season = seasonResult.data;

    if (
        seasonResult.error
        || !season?.time_window_start
        || !season.time_window_end
    ) {
        throw new Error(
            seasonResult.error?.message
                ?? "A rendelés módosítási időszaka hiányzik.",
        );
    }

    const pickupDate = order.pickup_days?.pickup_date;
    const items = order.current_version?.order_items;

    if (!pickupDate || !items) {
        throw new Error("A rendelés értesítési adatai hiányosak.");
    }

    const customerName = [
        profileResult.data?.last_name,
        profileResult.data?.first_name,
    ].filter(Boolean).join(" ").trim() || "Vásárlónk";
    const recipient = options.asAdmin
        ? profileResult.data?.email
        : user.email;

    if (!recipient) {
        throw new Error("A rendeléshez tartozó e-mail-cím nem érhető el.");
    }

    return {
        recipient,
        data: {
            kind,
            orderId: order.id,
            orderNumber: order.public_order_number,
            customerName,
            pickupDate,
            modificationWindowStart: season.time_window_start,
            modificationWindowEnd: season.time_window_end,
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
