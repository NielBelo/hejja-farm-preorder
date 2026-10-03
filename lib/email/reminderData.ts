import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isBacsKiskunCounty } from "@/lib/countyGroups";
import {
    loadOrderNotificationData,
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
