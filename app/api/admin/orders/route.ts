import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminOrdersByPickupDayIds, getAdminSeasonOptions } from "@/lib/adminOrderData";

const privateHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: privateHeaders });
}

export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return json({ error: "A munkamenet lejárt. Jelentkezzen be újra." }, 401);
    }

    const { data: userRole, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

    if (roleError) {
        return json({ error: "A jogosultság ellenőrzése sikertelen." }, 500);
    }
    if (userRole?.role !== "admin") {
        return json({ error: "Ehhez a művelethez adminisztrátori jogosultság szükséges." }, 403);
    }

    const seasonKey = request.nextUrl.searchParams.get("season")?.trim() ?? "";
    if (!seasonKey) {
        return json({ error: "Nincs kiválasztva szezon." }, 400);
    }

    try {
        const seasonOptions = await getAdminSeasonOptions(supabase);
        const season = seasonOptions.find((option) => option.value === seasonKey);

        if (!season) {
            return json({ error: "A kiválasztott szezon nem található." }, 404);
        }

        const orders = await getAdminOrdersByPickupDayIds(supabase, season.pickupDayIds);
        return json({ season: season.value, orders });
    } catch (error) {
        console.error("Admin season order query failed:", error);
        return json({ error: "A rendelések betöltése sikertelen." }, 500);
    }
}
