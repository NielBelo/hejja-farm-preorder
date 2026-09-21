import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import SeasonManager from "@/components/admin/SeasonManager";

export default async function AdminSeasonsPage() {
  const user = await getCurrentUser(); if (!user?.isAdmin) redirect("/preorder");
  const supabase = await createClient();
  // A pickupResult csak NORMÁL napokat tartalmaz: a DUNAVECSE technikai nap
  // sosem jelenik meg a szerkeszthető, admin által kezelt napok listájában
  // (automatikusan jön létre/frissül, lásd admin_save_season_parameters).
  // Külön, dunavecseResult lekérdezéssel töltjük be szezononként az egyetlen
  // DUNAVECSE napot, hogy az admin láthassa és aktiválhassa/deaktiválhassa
  // (ugyanazzal az admin_set_pickup_day_active RPC-vel, mint bármely más
  // átvételi napot).
  const [seasonsResult, pickupResult, dunavecseResult, ordersResult] = await Promise.all([
    supabase.from("season_parameters").select("*").order("year", { ascending: false }),
    supabase.from("pickup_days").select("id, season_parameter_id, pickup_date, planned_stock, available_stock, is_active").eq("kind", "normal").order("pickup_date"),
    supabase.from("pickup_days").select("id, season_parameter_id, pickup_date, is_active").eq("kind", "dunavecse"),
    supabase.from("orders").select("pickup_day_id, status"),
  ]);
  if (seasonsResult.error || pickupResult.error || dunavecseResult.error || ordersResult.error) throw new Error(seasonsResult.error?.message || pickupResult.error?.message || dunavecseResult.error?.message || ordersResult.error?.message);
  // Két külön fogalmat tartunk számon egy-egy átvételi napról, ezeket nem
  // szabad összekeverni: orderCount az AKTÍV (submitted) foglalást tükrözi a
  // statisztikához, hasOrderHistory viszont azt, hogy tartozott-e hozzá
  // VALAHA bármilyen (akár lemondott) rendelés. A fizikai törlés (lásd
  // admin_save_season_parameters) a rendelési előzmény megőrzése miatt
  // hasOrderHistory alapján van tiltva, státusztól függetlenül - ezt itt is
  // figyelembe vesszük, hogy a szerkesztő eleve ne kínálja fel a törlés
  // lehetőségét olyan napokra, amiket a mentés úgyis elutasítana. A
  // lefoglalt csirkemennyiség a planned_stock és az available_stock
  // különbsége (utóbbit a lemondott rendelések visszaadják). Ugyanezek a
  // Map-ek a DUNAVECSE nap statisztikáihoz is felhasználhatók, hiszen
  // orders.pickup_day_id-ből származnak, kind-tól függetlenül.
  const orderCountsByDay = new Map<number, number>();
  const daysWithOrderHistory = new Set<number>();
  for (const order of ordersResult.data ?? []) {
    daysWithOrderHistory.add(order.pickup_day_id);
    if (order.status === "submitted") orderCountsByDay.set(order.pickup_day_id, (orderCountsByDay.get(order.pickup_day_id) ?? 0) + 1);
  }
  const dunavecseBySeasonId = new Map((dunavecseResult.data ?? []).map((row) => [row.season_parameter_id, row]));
  const seasons = (seasonsResult.data ?? []).map((row) => {
    const dunavecse = dunavecseBySeasonId.get(row.id);
    return {
      id: String(row.id), year: row.year, type: row.season, price: row.price ?? 0, weightMin: row.weight_min ?? 0, weightMax: row.weight_max ?? 0, orderStart: row.time_window_start?.slice(0, 10) ?? "", orderEnd: row.time_window_end?.slice(0, 10) ?? "", pickupTimeStart: row.pickup_time_start?.slice(0, 5) ?? "", pickupTimeEnd: row.pickup_time_end?.slice(0, 5) ?? "", localPickupTimeStart: row.local_pickup_time_start?.slice(0, 5) ?? "", active: row.is_active === true, created_at: row.created_at,
      pickupDays: (pickupResult.data ?? []).filter((day) => day.season_parameter_id === row.id).map((day) => ({ id: day.id, date: day.pickup_date?.slice(0, 10) ?? "", limit: Number(day.planned_stock), active: day.is_active === true, orderCount: orderCountsByDay.get(day.id) ?? 0, reservedQuantity: Number(day.planned_stock ?? 0) - Number(day.available_stock ?? 0), hasOrderHistory: daysWithOrderHistory.has(day.id) })),
      dunavecse: dunavecse
        ? { id: dunavecse.id, date: dunavecse.pickup_date?.slice(0, 10) ?? "", active: dunavecse.is_active === true, orderCount: orderCountsByDay.get(dunavecse.id) ?? 0, hasOrderHistory: daysWithOrderHistory.has(dunavecse.id) }
        : null,
    };
  });
  return <main className="mx-auto w-full max-w-5xl"><div className="px-4 text-center sm:px-6"><h1 className="text-2xl font-bold text-gray-800">Szezonok szerkesztése</h1><p className="mx-auto mt-2 max-w-3xl text-base leading-7 text-gray-600 italic">Itt kezelheti az előrendelési időszakokat, az átvételi napokat és az aktuális szezon adatait.</p></div><div className="mt-6"><SeasonManager seasons={seasons} /></div></main>;
}
