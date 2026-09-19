"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type PickupDay = { date: string; limit: number };
export type SeasonInput = { id?: string; year: number; type: "Tavasz" | "Ősz"; price: number; weightMin: number; weightMax: number; orderStart: string; orderEnd: string; pickupTimeStart: string; pickupTimeEnd: string; localPickupTimeStart: string; pickupDays: PickupDay[]; active: boolean };

export async function saveSeason(input: SeasonInput) {
  if (!Number.isInteger(input.year) || !["Tavasz", "Ősz"].includes(input.type) || input.pickupDays.length < 1 || input.pickupDays.length > 5 || !Number.isFinite(input.price) || input.price < 0 || !Number.isFinite(input.weightMin) || input.weightMin <= 0 || !Number.isFinite(input.weightMax) || input.weightMax < input.weightMin || !input.orderStart || !input.orderEnd || input.orderStart > input.orderEnd || input.pickupDays.some((day) => !day.date || !Number.isInteger(day.limit) || day.limit < 1)) return { success: false as const, error: "Töltse ki helyesen a szezon minden adatát és 1–5 átvételi napot." };
  if (!input.pickupTimeStart || !input.pickupTimeEnd || !input.localPickupTimeStart) return { success: false as const, error: "Adja meg az átvétel kezdő és befejező, valamint a helyi (tanyasi) átvétel kezdő időpontját." };
  if (input.pickupTimeStart >= input.pickupTimeEnd) return { success: false as const, error: "Az átvétel kezdete legyen korábbi, mint az átvétel vége." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "A mentéshez jelentkezzen be újra." };
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges." };
  const { error } = await supabase.rpc("admin_save_season_parameters", { season_data: input });
  if (error) return { success: false as const, error: error.message || "A szezon mentése sikertelen." };
  revalidatePath("/admin/seasons"); revalidatePath("/preorder");
  return { success: true as const };
}

export async function deleteSeason(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "A törléshez jelentkezzen be újra." };
  const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges." };
  const { error } = await supabase.rpc("admin_delete_season_parameters", { target_id: Number(id) });
  if (error) return { success: false as const, error: error.message || "A szezon törlése sikertelen." };
  revalidatePath("/admin/seasons"); revalidatePath("/preorder");
  return { success: true as const };
}
