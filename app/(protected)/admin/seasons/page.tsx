import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getCalendarDate } from "@/lib/orderWindow";
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
  // A törölt (archivált) szezonok és napok is betöltődnek: a felület külön
  // mutatja őket, és onnan visszaállíthatók. Az archivált napok nem számítanak
  // bele a szezon aktív napjai közé (pickupDays), csak a deletedDays listába.
  const [seasonsResult, pickupResult, dunavecseResult, ordersResult, pricesResult, productsResult] = await Promise.all([
    supabase.from("season_parameters").select("*").order("year", { ascending: false }),
    supabase.from("pickup_days").select("id, season_parameter_id, pickup_date, planned_stock, available_stock, is_active, small_size_limit, large_size_limit, archived_at").eq("kind", "normal").order("pickup_date"),
    supabase.from("pickup_days").select("id, season_parameter_id, pickup_date, is_active").eq("kind", "dunavecse"),
    supabase
      .from("orders")
      .select("pickup_day_id, status, order_versions!orders_current_version_id_fkey(order_items(quantity))"),
    supabase.from("season_product_prices").select("season_parameter_id, product_id, price"),
    supabase.from("products").select("id, name").order("id"),
  ]);
  if (seasonsResult.error || pickupResult.error || dunavecseResult.error || ordersResult.error || pricesResult.error || productsResult.error) throw new Error(seasonsResult.error?.message || pickupResult.error?.message || dunavecseResult.error?.message || ordersResult.error?.message || pricesResult.error?.message || productsResult.error?.message);
  const products = (productsResult.data ?? []).map((product) => ({ id: product.id as number, name: product.name as string }));
  // Két külön fogalmat tartunk számon egy-egy átvételi napról, ezeket nem
  // szabad összekeverni: orderCount az AKTÍV (submitted) foglalást tükrözi a
  // statisztikához, hasOrderHistory viszont azt, hogy tartozott-e hozzá
  // VALAHA bármilyen (akár lemondott) rendelés. A fizikai törlés (lásd
  // admin_save_season_parameters) a rendelési előzmény megőrzése miatt
  // hasOrderHistory alapján van tiltva, státusztól függetlenül - ezt itt is
  // figyelembe vesszük, hogy a szerkesztő eleve ne kínálja fel a törlés
  // lehetőségét olyan napokra, amiket a mentés úgyis elutasítana. A normál
  // napok lefoglalt csirkemennyisége a planned_stock és az available_stock
  // különbségéből adódik (utóbbit a lemondott rendelések visszaadják), de a
  // DUNAVECSE napnak nincs ilyen stock-párja (korlátlan kapacitás, lásd
  // pickup_days_kind_check), ezért ennél a rendeléstételek (order_items)
  // mennyiségéből összegezzük ugyanazt a "db csirke" statisztikát.
  // A .select() string alapján a Supabase kliens (Database-típusok nélkül)
  // az order_versions beágyazott kapcsolatot tömbként vélelmezi, valójában
  // viszont az orders.current_version_id egy-az-egyhez FK miatt PostgREST
  // egyetlen objektumként adja vissza (ugyanígy kezeli lib/adminOrderData.ts
  // is a saját order_versions lekérdezését).
  type OrderStatsRow = { pickup_day_id: number; status: string; order_versions: { order_items: { quantity: number }[] } | null };
  const orderCountsByDay = new Map<number, number>();
  const reservedQuantityByDay = new Map<number, number>();
  const daysWithOrderHistory = new Set<number>();
  for (const order of (ordersResult.data ?? []) as unknown as OrderStatsRow[]) {
    daysWithOrderHistory.add(order.pickup_day_id);
    if (order.status !== "submitted") continue;
    orderCountsByDay.set(order.pickup_day_id, (orderCountsByDay.get(order.pickup_day_id) ?? 0) + 1);
    const quantity = (order.order_versions?.order_items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    reservedQuantityByDay.set(order.pickup_day_id, (reservedQuantityByDay.get(order.pickup_day_id) ?? 0) + quantity);
  }
  const dunavecseBySeasonId = new Map((dunavecseResult.data ?? []).map((row) => [row.season_parameter_id, row]));
  const toPickupDay = (day: NonNullable<typeof pickupResult.data>[number]) => ({ id: day.id, date: day.pickup_date?.slice(0, 10) ?? "", limit: Number(day.planned_stock), active: day.is_active === true, smallSizeLimit: day.small_size_limit as number | null, largeSizeLimit: day.large_size_limit as number | null, orderCount: orderCountsByDay.get(day.id) ?? 0, reservedQuantity: Number(day.planned_stock ?? 0) - Number(day.available_stock ?? 0), hasOrderHistory: daysWithOrderHistory.has(day.id) });
  const seasons = (seasonsResult.data ?? []).map((row) => {
    const dunavecse = dunavecseBySeasonId.get(row.id);
    const seasonDays = (pickupResult.data ?? []).filter((day) => day.season_parameter_id === row.id);
    return {
      archived: row.archived_at != null, note: (row.note as string | null) ?? "",
      prices: (pricesResult.data ?? []).filter((entry) => entry.season_parameter_id === row.id).map((entry) => ({ productId: entry.product_id as number, price: entry.price as number })),
      deletedDays: seasonDays.filter((day) => day.archived_at != null).map(toPickupDay),
      id: String(row.id), year: row.year, type: row.season, price: row.price ?? 0, weightMin: row.weight_min ?? 0, weightMax: row.weight_max ?? 0, orderStart: (row.time_window_start ? getCalendarDate(row.time_window_start) : null) ?? "", orderEnd: (row.time_window_end ? getCalendarDate(row.time_window_end) : null) ?? "", pickupTimeStart: row.pickup_time_start?.slice(0, 5) ?? "", pickupTimeEnd: row.pickup_time_end?.slice(0, 5) ?? "", localPickupTimeStart: row.local_pickup_time_start?.slice(0, 5) ?? "", active: row.is_active === true, created_at: row.created_at,
      pickupDays: seasonDays.filter((day) => day.archived_at == null).map(toPickupDay),
      dunavecse: dunavecse
        ? { id: dunavecse.id, date: dunavecse.pickup_date?.slice(0, 10) ?? "", active: dunavecse.is_active === true, orderCount: orderCountsByDay.get(dunavecse.id) ?? 0, reservedQuantity: reservedQuantityByDay.get(dunavecse.id) ?? 0, hasOrderHistory: daysWithOrderHistory.has(dunavecse.id) }
        : null,
    };
  });
  return <main className="mx-auto w-full max-w-5xl"><div className="px-4 text-center sm:px-6"><h1 className="text-2xl font-bold text-gray-800">Szezonok szerkesztése</h1><p className="mx-auto mt-2 max-w-3xl text-base leading-7 text-gray-600 italic">Itt kezelheti az előrendelési időszakokat, az átvételi napokat és az aktuális szezon adatait.</p></div><div className="mt-6"><SeasonManager seasons={seasons} products={products} /></div></main>;
}
