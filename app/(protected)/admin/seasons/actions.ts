"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { SEASON_NOTE_MAX_LENGTH } from "@/lib/seasonNote";

// A napi méretlimit: a kisebb/nagyobb méretű csirkék maximális darabszáma az
// adott napon; null = nincs korlát.
export type PickupDay = { id?: number; date: string; limit: number; active?: boolean; smallSizeLimit?: number | null; largeSizeLimit?: number | null; orderCount?: number; reservedQuantity?: number; hasOrderHistory?: boolean };
export type ProductPrice = { productId: number; price: number };
// price: a régi, szezononkénti ár (season_parameters.price) - egyelőre kötelező,
// az "Egész" termék árával egyezik; prices: a termékenkénti árak.
// confirmLiveOrders: a mentés élő rendelésű napot is töröl.
export type SeasonInput = { id?: string; year: number; type: "Tavasz" | "Ősz"; price: number; prices?: ProductPrice[]; note?: string; weightMin: number; weightMax: number; orderStart: string; orderEnd: string; pickupTimeStart: string; pickupTimeEnd: string; localPickupTimeStart: string; pickupDays: PickupDay[]; active: boolean; confirmLiveOrders?: boolean };

// Az élő rendelést érintő törlések (és a mentésbe foglalt napkivétel) az
// adatbázisban megerősítéshez kötöttek: a LIVE_ORDERS_CONFIRMATION_REQUIRED hint
// jelzi, hogy a felületnek külön megerősítést kell kérnie, majd confirmLiveOrders
// jelzéssel újra kell küldenie a kérést.
const LIVE_ORDERS_HINT = "LIVE_ORDERS_CONFIRMATION_REQUIRED";
const rpcFailure = (error: { message?: string; hint?: string }, fallback: string) => ({
  success: false as const,
  error: error.message || fallback,
  needsConfirmation: error.hint === LIVE_ORDERS_HINT,
});

const isLimit = (value: unknown) => value === null || value === undefined || (Number.isInteger(value) && (value as number) >= 0);

export async function saveSeason(input: SeasonInput) {
  if (!Number.isInteger(input.year) || !["Tavasz", "Ősz"].includes(input.type) || input.pickupDays.length < 1 || input.pickupDays.length > 5 || !Number.isFinite(input.price) || input.price < 0 || !Number.isFinite(input.weightMin) || input.weightMin <= 0 || !Number.isFinite(input.weightMax) || input.weightMax < input.weightMin || !input.orderStart || !input.orderEnd || input.orderStart > input.orderEnd || input.pickupDays.some((day) => !day.date || !Number.isInteger(day.limit) || day.limit < 1)) return { success: false as const, needsConfirmation: false, error: "Töltse ki helyesen a szezon minden adatát és 1–5 átvételi napot." };
  if (!input.pickupTimeStart || !input.pickupTimeEnd || !input.localPickupTimeStart) return { success: false as const, needsConfirmation: false, error: "Adja meg az átvétel kezdő és befejező, valamint a helyi (tanyasi) átvétel kezdő időpontját." };
  if (input.pickupTimeStart >= input.pickupTimeEnd) return { success: false as const, needsConfirmation: false, error: "Az átvétel kezdete legyen korábbi, mint az átvétel vége." };
  if (input.pickupDays.some((day) => !isLimit(day.smallSizeLimit) || !isLimit(day.largeSizeLimit))) return { success: false as const, needsConfirmation: false, error: "A méretlimit legyen nemnegatív egész szám, vagy maradjon üresen (korlátlan)." };
  if (typeof input.note === "string" && input.note.trim().length > SEASON_NOTE_MAX_LENGTH) return { success: false as const, needsConfirmation: false, error: `A megjegyzés legfeljebb ${SEASON_NOTE_MAX_LENGTH} karakter lehet.` };
  if (input.prices && (input.prices.length < 1 || input.prices.some((entry) => !Number.isInteger(entry.productId) || !Number.isInteger(entry.price) || entry.price < 0) || new Set(input.prices.map((entry) => entry.productId)).size !== input.prices.length)) return { success: false as const, needsConfirmation: false, error: "Adja meg minden termék árát (nemnegatív egész szám)." };
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false as const, needsConfirmation: false, error: "A mentéshez jelentkezzen be újra." };
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return { success: false as const, needsConfirmation: false, error: "Adminisztrátori jogosultság szükséges." };
    const { error } = await supabase.rpc("admin_save_season_parameters", { season_data: input });
    if (error) return rpcFailure(error, "A szezon mentése sikertelen.");
    // A revalidálás sikertelensége nem jelenti azt, hogy maga a mentés (a fenti
    // RPC) sikertelen volt - ezt külön nyeljük el, nehogy egy már megtörtént
    // mentést hibaként jelentsünk vissza a felhasználónak.
    try { revalidatePath("/admin/seasons"); revalidatePath("/preorder"); } catch (revalidateError) {
      console.error("Szezon revalidálási hiba:", revalidateError);
    }
    return { success: true as const };
  } catch (unexpectedError) {
    console.error("Szezon mentési hiba:", unexpectedError);
    return {
      success: false as const,
      needsConfirmation: false,
      error: unexpectedError instanceof Error ? unexpectedError.message : "A szezon mentése váratlan hiba miatt sikertelen.",
    };
  }
}

// A DUNAVECSE (Bács-Kiskun) technikai nap aktiválása/deaktiválása -
// ugyanazt az admin_set_pickup_day_active RPC-t használja, mint bármely más
// átvételi nap egyedi ki-/bekapcsolása; a DUNAVECSE napot ez a nap-kezelő
// nem különbözteti meg, mert a jogosultsági és aktivitási szabályok
// egyformák. Deaktiválás bármikor lehetséges, aktiváláshoz a szezonnak
// aktívnak kell lennie (lásd az RPC definícióját).
export async function setDunavecsePickupDayActive(id: number, active: boolean) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false as const, error: "A módosításhoz jelentkezzen be újra." };
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges." };
    const { error } = await supabase.rpc("admin_set_pickup_day_active", { target_id: id, is_active: active });
    if (error) return { success: false as const, error: error.message || "A DUNAVECSE nap módosítása sikertelen." };
    try { revalidatePath("/admin/seasons"); revalidatePath("/preorder"); } catch (revalidateError) {
      console.error("DUNAVECSE nap revalidálási hiba:", revalidateError);
    }
    return { success: true as const };
  } catch (unexpectedError) {
    console.error("DUNAVECSE nap módosítási hiba:", unexpectedError);
    return {
      success: false as const,
      error: unexpectedError instanceof Error ? unexpectedError.message : "A DUNAVECSE nap módosítása váratlan hiba miatt sikertelen.",
    };
  }
}

// Közös váz a szezon/nap törlő és visszaállító műveletekhez: admin
// jogosultság ellenőrzése, RPC hívás, revalidálás.
async function runSeasonRpc(rpcName: string, args: Record<string, unknown>, messages: { signIn: string; failed: string; unexpected: string }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false as const, error: messages.signIn, needsConfirmation: false };
    const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges.", needsConfirmation: false };
    const { error } = await supabase.rpc(rpcName, args);
    if (error) return rpcFailure(error, messages.failed);
    try { revalidatePath("/admin/seasons"); revalidatePath("/preorder"); } catch (revalidateError) {
      console.error("Szezon revalidálási hiba:", revalidateError);
    }
    return { success: true as const };
  } catch (unexpectedError) {
    console.error(`${rpcName} hiba:`, unexpectedError);
    return {
      success: false as const,
      error: unexpectedError instanceof Error ? unexpectedError.message : messages.unexpected,
      needsConfirmation: false,
    };
  }
}

// Soft delete: a szezon és napjai archiválódnak, a rendelések érintetlenek.
// Élő rendelés esetén needsConfirmation: true jön vissza, és a törlés csak
// confirmLiveOrders = true újrahívással hajtódik végre.
export async function deleteSeason(id: string, confirmLiveOrders = false) {
  return runSeasonRpc("admin_delete_season_parameters", { target_id: Number(id), confirm_live_orders: confirmLiveOrders }, {
    signIn: "A törléshez jelentkezzen be újra.",
    failed: "A szezon törlése sikertelen.",
    unexpected: "A szezon törlése váratlan hiba miatt sikertelen.",
  });
}

export async function restoreSeason(id: string) {
  return runSeasonRpc("admin_restore_season_parameters", { target_id: Number(id) }, {
    signIn: "A visszaállításhoz jelentkezzen be újra.",
    failed: "A szezon visszaállítása sikertelen.",
    unexpected: "A szezon visszaállítása váratlan hiba miatt sikertelen.",
  });
}

export async function restorePickupDay(id: number) {
  return runSeasonRpc("admin_restore_pickup_day", { target_id: id }, {
    signIn: "A visszaállításhoz jelentkezzen be újra.",
    failed: "Az átvételi nap visszaállítása sikertelen.",
    unexpected: "Az átvételi nap visszaállítása váratlan hiba miatt sikertelen.",
  });
}
