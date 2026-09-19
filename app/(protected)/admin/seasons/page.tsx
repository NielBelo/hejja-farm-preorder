import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import SeasonManager from "@/components/admin/SeasonManager";

export default async function AdminSeasonsPage() {
  const user = await getCurrentUser(); if (!user?.isAdmin) redirect("/preorder");
  const supabase = await createClient();
  const [seasonsResult, pickupResult] = await Promise.all([supabase.from("season_parameters").select("*").order("year", { ascending: false }), supabase.from("pickup_days").select("season_parameter_id, pickup_date, planned_stock").order("pickup_date")]);
  if (seasonsResult.error || pickupResult.error) throw new Error(seasonsResult.error?.message || pickupResult.error?.message);
  const seasons = (seasonsResult.data ?? []).map((row) => ({ id: String(row.id), year: row.year, type: row.season, price: row.price ?? 0, weightMin: row.weight_min ?? 0, weightMax: row.weight_max ?? 0, orderStart: row.time_window_start?.slice(0, 10) ?? "", orderEnd: row.time_window_end?.slice(0, 10) ?? "", pickupTimeStart: row.pickup_time_start?.slice(0, 5) ?? "", pickupTimeEnd: row.pickup_time_end?.slice(0, 5) ?? "", localPickupTimeStart: row.local_pickup_time_start?.slice(0, 5) ?? "", active: row.is_active === true, created_at: row.created_at, pickupDays: (pickupResult.data ?? []).filter((day) => day.season_parameter_id === row.id).map((day) => ({ date: day.pickup_date?.slice(0, 10) ?? "", limit: Number(day.planned_stock) })) }));
  return <main className="mx-auto w-full max-w-5xl"><div className="px-4 text-center sm:px-6"><h1 className="text-2xl font-bold text-gray-800">Szezonok szerkesztése</h1><p className="mx-auto mt-2 max-w-3xl text-base leading-7 text-gray-600 italic">Itt kezelheti az előrendelési időszakokat, az átvételi napokat és az aktuális szezon adatait.</p></div><div className="mt-6"><SeasonManager seasons={seasons} /></div></main>;
}
