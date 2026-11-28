import { supabase } from "@/lib/supabase";
// page.tsx
import PreorderManager from "@/components/PreorderManager";
import SeasonOrderInfo from "@/components/SeasonOrderInfo";
import PreorderIntro from "@/components/PreorderIntro";
import CustomerFooter from "@/components/CustomerFooter";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";


export default async function PreorderPage() {
  const currentUser = await getCurrentUser();

  const { data } = await supabase
    .from("page_contents")
    .select("key, content, image_url")
    .in("key", ["order_info1", "order_info2"]);

  const { data: season } = await supabase
    .from("season_parameters")
    .select("*")
    .eq("is_active", true)
    .single();

  const { data: products } = await supabase
    .from("products")
    .select("id, name, description, image_url");

  // Termékenkénti árak (Ft/kg) az aktív szezonhoz.
  const { data: priceRows } = await supabase
    .from("season_product_prices")
    .select("product_id, price")
    .eq("season_parameter_id", season?.id ?? -1);
  const productPrices = Object.fromEntries(
    (priceRows ?? []).map((row) => [row.product_id as number, row.price as number])
  );

  // Naponként a még rendelhető kisebb/nagyobb méretű csirkék (a hívó
  // jogosultságával, ezért a bejelentkezett klienssel kérjük le).
  const authedSupabase = await createClient();
  const { data: sizeAvailabilityRows } = await authedSupabase.rpc(
    "get_pickup_day_size_availability"
  );

  const { data: packages } = await supabase
    .from("packages")
    .select("id, name, description, image_url");

  // A DUNAVECSE technikai nap sosem szerepelhet a normál napválasztóban
  // (ott csak kind = 'normal' napok jelenhetnek meg) - a Bács-Kiskun
  // vármegyei vásárlók automatikus "vágási nap" kártyáját külön, a
  // pickup_days.kind = 'dunavecse' sorból töltjük.
  const { data: pickupDays } = await supabase
    .from("pickup_days")
    .select("*")
    .eq("is_active", true)
    .eq("kind", "normal")
    .order("_group")
    .order("serial_number");

  const { data: dunavecseDay } = await supabase
    .from("pickup_days")
    .select("id, pickup_date, is_active")
    .eq("season_parameter_id", season?.id ?? -1)
    .eq("kind", "dunavecse")
    .maybeSingle();

  const orderInfo1 = data?.find((item) => item.key === "order_info1");
  const orderInfo2 = data?.find((item) => item.key === "order_info2");

  const orderInfo2Text = orderInfo2?.content
    ?.replace("{weight_min}", String(season?.weight_min))
    .replace("{weight_max}", String(season?.weight_max))
    .replace("{price}", String(season?.price));

  // A súly- és ársáv szövege az aktív szezonból jön; ha nincs aktív szezon,
  // a legutóbbi (év, majd évszak szerint: Ősz a Tavasz után) nem törölt szezonból.
  let infoSeason = season;
  if (!infoSeason) {
    const { data: latestSeasons } = await supabase
      .from("season_parameters")
      .select("year, season, weight_min, weight_max, price")
      .is("archived_at", null);
    infoSeason =
      [...(latestSeasons ?? [])].sort(
        (a, b) => b.year - a.year || Number(b.season === "Ősz") - Number(a.season === "Ősz")
      )[0] ?? null;
  }
  const priceInfoText =
    infoSeason?.weight_min != null && infoSeason?.weight_max != null && infoSeason?.price != null
      ? `A csirkék átlagos súlya felpucolva ${infoSeason.weight_min}–${infoSeason.weight_max} kg, az alapár pedig ${infoSeason.price} Ft/kg.`
      : null;

  return (
    <>
      <main className="mx-auto mt-4 w-full max-w-5xl">
        <PreorderIntro imageUrl={orderInfo1?.image_url}>
          {/* A megszólítás statikus; az első bekezdés (order_info1) sorkizárt. */}
          <div className="text-lg text-gray-600 leading-7">
            <p className="mb-2 text-center text-2xl font-bold">Kedves Vásárlóink!</p>
            <p className="hyphens-auto whitespace-pre-line text-justify">{orderInfo1?.content?.trim()}</p>
          </div>

          <div className="mt-4 hyphens-auto text-justify font-bold text-lg text-gray-600 leading-7 whitespace-pre-line">
            <SeasonOrderInfo
              startDate={season?.time_window_start}
              endDate={season?.time_window_end}
              seasonText={orderInfo2Text}
              fallbackText={priceInfoText}
            />
          </div>
        </PreorderIntro>

        <PreorderManager
          season={season}
          products={products ?? []}
          packages={packages ?? []}
          pickupDays={pickupDays ?? []}
          dunavecseDay={dunavecseDay ?? null}
          userCounty={currentUser?.county ?? null}
          sizeAvailabilityRows={sizeAvailabilityRows ?? []}
          productPrices={productPrices}
        />
      </main>
      <CustomerFooter />
    </>
  );
}
