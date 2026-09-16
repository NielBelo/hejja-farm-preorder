import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderNotificationData } from "@/lib/email/orderNotification";

type LatestVersionRow = {
    created_at: string;
    order_id: number;
    order_items: Array<{
        quantity: number;
        size_preference: string | null;
        note: string | null;
        products: { name: string } | null;
        packages: { name: string } | null;
    }>;
};

type OrderRow = {
    public_order_number: string;
    season_parameter_id: number;
    user_id: string;
    pickup_days: { pickup_date: string } | null;
};

export type LatestOrderUpdate = {
    modifiedAt: string;
    notificationData: OrderNotificationData;
};

export async function getLatestOrderUpdate(
    supabase: SupabaseClient,
): Promise<LatestOrderUpdate | null> {
    const { data: versionData, error: versionError } = await supabase
        .from("order_versions")
        .select(`
            created_at,
            order_id,
            order_items (
                quantity,
                size_preference,
                note,
                products (name),
                packages (name)
            )
        `)
        .gt("version_number", 1)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (versionError) {
        throw new Error(versionError.message);
    }

    if (!versionData) {
        return null;
    }

    const version = versionData as unknown as LatestVersionRow;
    const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select(`
            public_order_number,
            season_parameter_id,
            user_id,
            pickup_days!orders_pickup_day_id_fkey (pickup_date)
        `)
        .eq("id", version.order_id)
        .single();

    if (orderError || !orderData) {
        throw new Error(orderError?.message ?? "A módosított rendelés nem található.");
    }

    const order = orderData as unknown as OrderRow;
    const [profileResult, seasonResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("first_name, last_name")
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

    if (
        seasonResult.error
        || !seasonResult.data?.time_window_start
        || !seasonResult.data.time_window_end
    ) {
        throw new Error(
            seasonResult.error?.message ?? "A rendelés módosítási időszaka hiányzik.",
        );
    }

    const pickupDate = order.pickup_days?.pickup_date;

    if (!pickupDate) {
        throw new Error("A módosított rendelés átvételi napja hiányzik.");
    }

    const customerName = [
        profileResult.data?.last_name,
        profileResult.data?.first_name,
    ]
        .filter(Boolean)
        .join(" ")
        .trim() || "Vásárlónk";

    return {
        modifiedAt: version.created_at,
        notificationData: {
            kind: "updated",
            orderId: version.order_id,
            orderNumber: order.public_order_number,
            customerName,
            pickupDate,
            modificationWindowStart: seasonResult.data.time_window_start,
            modificationWindowEnd: seasonResult.data.time_window_end,
            items: version.order_items.map((item) => ({
                productName: item.products?.name ?? "Ismeretlen termék",
                packageName: item.packages?.name ?? "Ismeretlen csomagolás",
                quantity: item.quantity,
                sizePreference: item.size_preference,
                note: item.note,
            })),
        },
    };
}
