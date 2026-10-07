import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isBacsKiskunCounty } from "@/lib/countyGroups";
import {
    loadOrderNotificationData,
    notificationOrderSelect,
    type LoadedOrderNotification,
} from "@/lib/email/orderNotificationData";

// Az emlékeztető adatbetöltés ugyanazt a rendelés-értelmezést
// (loadOrderNotificationData) használja újra, amit a rendelési e-mailek is -
// nincs az emlékeztetőhöz külön, párhuzamos rendeléslekérdezés vagy
// -formázás. A "kind" itt technikai okból "created" (loadOrderNotificationData
// megköveteli), az emlékeztető sablon (lib/email/reminder.ts) ezt a mezőt
// egyáltalán nem használja fel.

// A Sablonok → Emlékeztető menüpont előnézetéhez a legutóbb leadott, még nem
// visszavont ("submitted") rendelések közül az elsőt adja vissza, amelynek
// vásárlója NEM Bács-Kiskun vármegyei - a DUNAVECSE/Bács-Kiskun vásárlók
// ugyanis sosem kapnak emlékeztetőt (lásd getReminderOrderTargetsForDate lent),
// ezért az előnézet se az ő rendelésükkel jelenjen meg.
export async function getLatestReminderSampleOrder(
    supabase: SupabaseClient,
    options: { asAdmin?: boolean } = {},
): Promise<LoadedOrderNotification | null> {
    const { data: latestOrders, error } = await supabase
        .from("orders")
        .select("id, user_id, created_at")
        .eq("status", "submitted")
        .order("created_at", { ascending: false })
        .limit(20);

    if (error || !latestOrders?.length) {
        return null;
    }

    const userIds = [...new Set(latestOrders.map((order) => order.user_id))];
    const { data: profiles } = await supabase
        .from("profiles")
        .select("id, county")
        .in("id", userIds);
    const countyByUserId = new Map((profiles ?? []).map((profile) => [profile.id, profile.county]));

    const candidate = latestOrders.find(
        (order) => !isBacsKiskunCounty(countyByUserId.get(order.user_id)),
    );

    if (!candidate) {
        return null;
    }

    return loadOrderNotificationData(supabase, { orderId: candidate.id }, "created", options);
}

export type ReminderOrderTarget = {
    orderId: number;
    pickupDayId: number;
};

// A ténylegesen kiküldendő emlékeztetők megállapítása egy adott átvételi
// napra: csak "submitted" állapotú rendelés számít, és csak a kind='normal'
// átvételi naphoz tartozó rendelések - a DUNAVECSE technikai nap dátuma
// alkalmanként (a szezon utolsó napján) megegyezhet egy normál nap
// dátumával, ezért a kind szerinti szűrés szükséges a puszta dátumegyezés
// mellett. A Bács-Kiskun vármegyei vásárló mindig a DUNAVECSE napra kerül
// (lásd supabase/migrations/20260921010000_bacskiskun_dunavecse.sql), így ez
// a szűrés önmagában is kizárja őket; lib/email/sendReminderEmail.ts a
// vásárló vármegyéjét a küldés előtt még egyszer, védekezően ellenőrzi.
//
// A pickupDayId is szükséges (nem csak az orderId): a
// lib/email/reminderSends.ts atomikus claim/finalize RPC-i a küldési
// naplóban a rendelés + átvételi nap párt azonosítják, ahogy azt az
// idempotencia-kényszer (supabase/migrations/20260930000000_reminder_sends.sql)
// is megköveteli.
type BatchOrderRow = {
    id: number;
    user_id: string;
    season_parameter_id: number;
    public_order_number: string;
    pickup_days: { pickup_date: string } | null;
    current_version: {
        order_items: {
            quantity: number;
            size_preference: string | null;
            note: string | null;
            products: { name: string } | null;
            packages: { name: string } | null;
        }[];
    } | null;
};

type BatchProfileRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    county: string | null;
};

type BatchSeasonRow = {
    id: number;
    time_window_start: string | null;
    time_window_end: string | null;
    pickup_time_start: string;
    pickup_time_end: string;
    local_pickup_time_start: string;
};

// Kötegelt betöltés egy worker-csomag rendeléseihez: pontosan 3 adatbázis-
// lekérdezés (rendelések, profilok, szezonok) a csomag méretétől függetlenül.
// A rendelésenkénti loadOrderNotificationData 3 lekérdezést (+ auth) futtatna
// rendelésenként, ami a Cloudflare Free 50 subrequest/futás korlátját
// szétlőné. Az eredmény alakja megegyezik a loadOrderNotificationData
// (serviceRole) kimenetével. Hiányos adatú rendelés kimarad a térképből,
// és a hívó "nincs adat" kimenetelt kap rá - nem dobja el az egész csomagot.
export async function loadReminderOrdersBatch(
    supabase: SupabaseClient,
    orderIds: number[],
): Promise<Map<number, LoadedOrderNotification>> {
    const result = new Map<number, LoadedOrderNotification>();
    if (orderIds.length === 0) {
        return result;
    }

    const { data: orderRows, error: ordersError } = await supabase
        .from("orders")
        .select(notificationOrderSelect)
        .in("id", orderIds);

    if (ordersError) {
        throw new Error(ordersError.message);
    }

    const orders = (orderRows ?? []) as unknown as BatchOrderRow[];
    const userIds = [...new Set(orders.map((order) => order.user_id))];
    const seasonIds = [...new Set(orders.map((order) => order.season_parameter_id))];

    const [profilesResult, seasonsResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("id, first_name, last_name, email, county")
            .in("id", userIds),
        supabase
            .from("season_parameters")
            .select("id, time_window_start, time_window_end, pickup_time_start, pickup_time_end, local_pickup_time_start")
            .in("id", seasonIds),
    ]);

    if (profilesResult.error) {
        throw new Error(profilesResult.error.message);
    }
    if (seasonsResult.error) {
        throw new Error(seasonsResult.error.message);
    }

    const profiles = new Map(((profilesResult.data ?? []) as unknown as BatchProfileRow[]).map((row) => [row.id, row]));
    const seasons = new Map(((seasonsResult.data ?? []) as unknown as BatchSeasonRow[]).map((row) => [row.id, row]));

    for (const order of orders) {
        const profile = profiles.get(order.user_id);
        const season = seasons.get(order.season_parameter_id);
        const pickupDate = order.pickup_days?.pickup_date;
        const items = order.current_version?.order_items;

        if (!profile?.email || !season?.time_window_start || !season.time_window_end || !pickupDate || !items) {
            console.error(`[reminder] Hiányos rendelésadat (#${order.id}) - ez a rendelés kimarad a futásból.`);
            continue;
        }

        const customerName = [profile.last_name, profile.first_name].filter(Boolean).join(" ").trim() || "Vásárlónk";

        result.set(order.id, {
            recipient: profile.email,
            data: {
                kind: "created",
                orderId: order.id,
                orderNumber: order.public_order_number,
                customerName,
                pickupDate,
                pickupTimeStart: season.pickup_time_start,
                pickupTimeEnd: season.pickup_time_end,
                localPickupTimeStart: season.local_pickup_time_start,
                county: profile.county ?? null,
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
        });
    }

    return result;
}

export async function getReminderOrderTargetsForDate(
    supabase: SupabaseClient,
    pickupDateIso: string,
): Promise<ReminderOrderTarget[]> {
    const { data, error } = await supabase
        .from("orders")
        .select("id, pickup_day_id, pickup_days!orders_pickup_day_id_fkey!inner(pickup_date, kind)")
        .eq("status", "submitted")
        .eq("pickup_days.pickup_date", pickupDateIso)
        .eq("pickup_days.kind", "normal");

    if (error) {
        throw new Error(error.message);
    }

    return (data ?? []).map((row) => ({
        orderId: row.id as number,
        pickupDayId: row.pickup_day_id as number,
    }));
}
