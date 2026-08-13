import Image from "next/image";
import { supabase } from "@/lib/supabase";
// page.tsx
import PreorderManager from "@/components/PreorderManager";


export default async function PreorderPage() {
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

  const { data: packages } = await supabase
    .from("packages")
    .select("id, name, description");

  const { data: pickupDays } = await supabase
    .from("pickup_days")
    .select("*")
    .eq("is_active", true)
    .order("_group")
    .order("serial_number");

  const orderInfo1 = data?.find((item) => item.key === "order_info1");
  const orderInfo2 = data?.find((item) => item.key === "order_info2");

  const orderInfo2Text = orderInfo2?.content
    ?.replace("{weight_min}", String(season?.weight_min))
    .replace("{weight_max}", String(season?.weight_max))
    .replace("{price}", String(season?.price));

  return (
    <main className="mx-auto mt-4 w-full max-w-5xl">
      <div className="flex gap-8 items-start">
        {orderInfo1?.image_url && (
          <Image
            src={orderInfo1.image_url}
            alt="Csirkék a Héjja-farmon"
            width={400}
            height={400}
            className="w-full h-auto rounded-xl"
            priority
          />
        )}

        <div>
          <div className="text-base text-gray-600 leading-7 whitespace-pre-line">
            {orderInfo1?.content}
          </div>

          <div className="mt-8 font-bold text-base text-gray-600 leading-7 whitespace-pre-line">
            {orderInfo2Text}
          </div>
        </div>
      </div>

      <PreorderManager
        season={season}
        products={products ?? []}
        packages={packages ?? []}
        pickupDays={pickupDays ?? []}
      />
    </main>
  );
}