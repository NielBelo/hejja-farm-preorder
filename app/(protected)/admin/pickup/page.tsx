import PickupSheet from "@/components/admin/PickupSheet";
import { createClient } from "@/lib/supabase/server";
import {
    buildAdminSeasonOptions,
    getDefaultAdminSeason,
    getPickupSeason,
    type PickupDaySeasonRow,
} from "@/lib/adminOrderFilters";
import {
    getPickupDateOptions,
    normalizePickupDate,
    sortPickupOrders,
    type PickupSheetItem,
    type PickupSheetOrder,
    type PickupSheetPickupDay,
} from "@/lib/pickupSheet";

type RawOrder = {
    id: number;
    public_order_number: string;
    user_id: string;
    pickup_days: { pickup_date: string; kind: string; year: number; season: string | null } | null;
    current_version: { order_items: PickupSheetItem[] } | null;
};

export default async function AdminPickupPage() {
    const supabase = await createClient();
    const [ordersResult, pickupDaysResult] = await Promise.all([
        supabase
            .from("orders")
            .select(`
                id,
                public_order_number,
                user_id,
                pickup_days!orders_pickup_day_id_fkey!inner (pickup_date, kind, year, season),
                current_version:order_versions!orders_current_version_id_fkey (
                    order_items (
                        id,
                        quantity,
                        size_preference,
                        note,
                        products (name),
                        packages (name)
                    )
                )
            `)
            .eq("status", "submitted"),
        // Szándékosan NINCS .eq("is_active", true) vagy szezonszűrés: az
        // admin a korábbi (nem aktív) szezonok átvételi napjait is vissza
        // tudja nézni a szezonválasztóval, ugyanúgy, ahogy az
        // app/(protected)/admin/orders/page.tsx is minden NORMÁL napot
        // (aktívat és inaktívat is) betölt. A DUNAVECSE technikai nap is
        // szerepel ebben a listában (nincs .eq("kind", "normal") szűrés),
        // hogy az admin átvételi nap választójában külön napként
        // megjelenhessen és kiválasztható legyen - lásd lib/pickupSheet.ts
        // getPickupDateOptions(). A DUNAVECSE nap pickup_date-je mindig
        // megegyezik a szezon utolsó normál napjával, de kind='dunavecse'
        // miatt a getPickupDateOptions ettől függetlenül külön opcióként
        // kezeli, nem olvasztja össze a normál nappal. Korlátlan kapacitása
        // miatt (planned_stock/available_stock NULL) a napi készlet %-os
        // megjelenítése erre a napra nem értelmezhető - ezt a PickupSheet
        // komponens kezeli.
        supabase
            .from("pickup_days")
            .select("id, year, season, pickup_date, planned_stock, available_stock, kind, is_active")
            .order("pickup_date", { ascending: true }),
    ]);

    if (ordersResult.error) throw new Error(ordersResult.error.message);
    if (pickupDaysResult.error) throw new Error(pickupDaysResult.error.message);

    const rawOrders = (ordersResult.data ?? []) as unknown as RawOrder[];
    const userIds = [...new Set(rawOrders.map((order) => order.user_id))];
    const { data: profiles, error: profileError } = userIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, phone, special_size_preference")
            .in("id", userIds)
        : { data: [], error: null };

    if (profileError) throw new Error(profileError.message);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const orders = sortPickupOrders(rawOrders.map<PickupSheetOrder>((order) => {
        const profile = profileMap.get(order.user_id);
        return {
            id: order.id,
            public_order_number: order.public_order_number,
            user_id: order.user_id,
            pickupDate: normalizePickupDate(order.pickup_days?.pickup_date ?? ""),
            pickupKind: order.pickup_days?.kind === "dunavecse" ? "dunavecse" : "normal",
            pickupSeasonValue: getPickupSeason(order.pickup_days?.year, order.pickup_days?.season).value,
            customerName: [profile?.last_name, profile?.first_name]
                .filter(Boolean).join(" ").trim() || "Ismeretlen vásárló",
            phone: profile?.phone ?? "—",
            items: order.current_version?.order_items ?? [],
            specialSizePreference: profile?.special_size_preference ?? null,
        };
    }));
    const pickupDays = (pickupDaysResult.data ?? []) as PickupSheetPickupDay[];
    const pickupDates = getPickupDateOptions(pickupDays);
    // Ugyanaz a bevett szezon-helper (lásd lib/adminOrderData.ts
    // getAdminSeasonOptions/lib/adminOrderFilters.ts), amit az
    // /admin/orders oldal is használ: year+season alapján csoportosít,
    // és a legutóbbi aktív (ennek hiányában a legutóbbi) szezont adja
    // alapértelmezettnek.
    const seasonOptions = buildAdminSeasonOptions(
        (pickupDaysResult.data ?? []) as PickupDaySeasonRow[]
    );
    const defaultSeason = getDefaultAdminSeason(seasonOptions);

    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="print-hidden px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    <span className="block">Válassza ki a szezont és az átvételi napot az adott napi előrendelések, valamint az aznapi mennyiségek és eloszlások áttekintéséhez.</span>
                    <span className="mt-0.5 block">Az előkészített átvételi listát közvetlenül kinyomtathatja vagy PDF-ként mentheti.</span>
                </p>
            </div>
            <div className="mt-6 print:mt-0">
                <PickupSheet
                    orders={orders}
                    pickupDates={pickupDates}
                    seasonOptions={seasonOptions.map(({ value, label }) => ({ value, label }))}
                    initialSeason={defaultSeason?.value ?? ""}
                />
            </div>
        </div>
    );
}
