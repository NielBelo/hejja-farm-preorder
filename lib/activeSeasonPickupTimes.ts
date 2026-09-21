import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Az admin fejlesztői előnézetek (Sablonok) ne elavult, hardcode-olt minta-
// időpontokat mutassanak, hanem a jelenleg aktív szezon season_parameters
// rekordjából olvasott, valós beállításokat - ugyanazt az oszlopkészletet,
// amit az éles előrendelési folyamat (app/(protected)/preorder/page.tsx) is
// használ.
export type ActiveSeasonPickupTimes = {
    pickupTimeStart: string | null;
    pickupTimeEnd: string | null;
    localPickupTimeStart: string | null;
};

export async function getActiveSeasonPickupTimes(
    supabase: SupabaseClient,
): Promise<ActiveSeasonPickupTimes | null> {
    const { data } = await supabase
        .from("season_parameters")
        .select("pickup_time_start, pickup_time_end, local_pickup_time_start")
        .eq("is_active", true)
        .maybeSingle();

    if (!data) {
        return null;
    }

    return {
        pickupTimeStart: data.pickup_time_start,
        pickupTimeEnd: data.pickup_time_end,
        localPickupTimeStart: data.local_pickup_time_start,
    };
}
