import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Szerveroldali védelem: a rendelés átvételi napja csak a rendelés saját
// szezonjának (orders.season_parameter_id) másik napjára módosítható.
// Visszatérési érték: hibaüzenet, ha a módosítás nem engedélyezett, egyébként null.
export async function getCrossSeasonPickupDayError(
    supabase: SupabaseClient,
    orderId: number,
    newPickupDayId: number
): Promise<string | null> {
    const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("pickup_day_id, season_parameter_id")
        .eq("id", orderId)
        .maybeSingle();

    if (orderError || !order) {
        return "A rendelés átvételi napjának ellenőrzése sikertelen.";
    }

    // Napváltás nélkül nincs mit ellenőrizni.
    if (order.pickup_day_id === newPickupDayId) return null;

    const { data: newDay, error: newDayError } = await supabase
        .from("pickup_days")
        .select("season_parameter_id")
        .eq("id", newPickupDayId)
        .maybeSingle();

    if (newDayError || !newDay) {
        return "A kiválasztott új átvételi nap nem létezik.";
    }

    if (
        order.season_parameter_id == null
        || newDay.season_parameter_id !== order.season_parameter_id
    ) {
        return "A rendelés csak a saját szezonjának átvételi napjára helyezhető át.";
    }

    return null;
}
