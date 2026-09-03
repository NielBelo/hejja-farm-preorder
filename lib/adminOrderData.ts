import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminOrder } from "@/components/admin/AdminOrderCard";
import {
    buildAdminSeasonOptions,
    type AdminSeasonOption,
    type PickupDaySeasonRow,
} from "@/lib/adminOrderFilters";

const orderSelect = `
    id,
    public_order_number,
    status,
    cancelled_by,
    created_at,
    current_version_id,
    user_id,
    pickup_day_id,

    pickup_days!orders_pickup_day_id_fkey!inner (
        id,
        year,
        season,
        pickup_date,
        serial_number,
        available_stock,
        planned_stock
    ),

    order_versions!orders_current_version_id_fkey (
        id,
        version_number,
        created_at,

        order_items (
            id,
            product_id,
            package_id,
            quantity,
            size_preference,
            note,

            products (
                id,
                name
            ),

            packages (
                id,
                name
            )
        )
    )
`;

export async function getAdminSeasonOptions(supabase: SupabaseClient): Promise<AdminSeasonOption[]> {
    const { data, error } = await supabase
        .from("pickup_days")
        .select("id, year, season, pickup_date, is_active")
        .order("pickup_date", { ascending: true });

    if (error) throw new Error(error.message);

    return buildAdminSeasonOptions((data ?? []) as PickupDaySeasonRow[]);
}

export async function getAdminOrdersByPickupDayIds(
    supabase: SupabaseClient,
    pickupDayIds: number[]
): Promise<AdminOrder[]> {
    if (pickupDayIds.length === 0) return [];

    const { data, error } = await supabase
        .from("orders")
        .select(orderSelect)
        .in("pickup_day_id", pickupDayIds)
        .in("status", ["submitted", "cancelled"])
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const typedOrders = (data ?? []) as unknown as Omit<AdminOrder, "profile" | "cancelledByName">[];
    const userIds = [
        ...new Set(typedOrders.flatMap((order) => (
            order.status === "cancelled" && order.cancelled_by
                ? [order.user_id, order.cancelled_by]
                : [order.user_id]
        ))),
    ];

    const { data: profiles, error: profilesError } = userIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, email, phone, city, county")
            .in("id", userIds)
        : { data: [], error: null };

    if (profilesError) throw new Error(profilesError.message);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    return typedOrders.map((order) => {
        const cancelledByProfile = order.cancelled_by
            ? profileMap.get(order.cancelled_by)
            : null;

        return {
            ...order,
            profile: profileMap.get(order.user_id) ?? null,
            cancelledByName: cancelledByProfile
                ? [cancelledByProfile.last_name, cancelledByProfile.first_name]
                    .filter(Boolean)
                    .join(" ")
                    .trim() || null
                : null,
        } as AdminOrder;
    });
}
