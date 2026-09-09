"use server";

import { createClient } from "@/lib/supabase/server";
import { sendOrderNotification } from "@/lib/email/sendOrderNotification";
import { normalizePackageId } from "@/lib/orderPackaging";

export type SubmitOrderItem = {
  product_id: number;
  package_id: number;
  quantity: number;
  size_preference: string;
  note: string | null;
};

export type SubmitOrderData = {
  seasonParameterId: number;
  pickupDayId: number;
  items: SubmitOrderItem[];
};

export async function submitOrder(data: SubmitOrderData) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      error: "Nincs bejelentkezett felhasználó.",
    };
  }

  const productIds = [...new Set(data.items.map((item) => item.product_id))];
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name")
    .in("id", productIds);
  const { data: packages, error: packagesError } = await supabase
    .from("packages")
    .select("id, name");

  if (productsError || packagesError) {
    return {
      success: false,
      error: "A csomagolási beállítások ellenőrzése sikertelen.",
    };
  }

  const normalizedItems = data.items.map((item) => ({
    ...item,
    package_id: normalizePackageId({
      product: products?.find((product) => product.id === item.product_id),
      quantity: item.quantity,
      selectedPackageId: item.package_id,
      packages: packages ?? [],
    }),
  }));

  if (normalizedItems.some((item) => item.package_id === null)) {
    return {
      success: false,
      error: "Az egyedi csomagolás nem található a beállítások között.",
    };
  }

  const { data: orderNumber, error } = await supabase.rpc("finalize_order", {
    p_season_parameter_id: data.seasonParameterId,
    p_pickup_day_id: data.pickupDayId,
    p_items: normalizedItems,
  });

  if (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const publicOrderNumber = String(orderNumber);
  let emailWarning: string | undefined;
  let emailRecipient: string | undefined;

  try {
    const notification = await sendOrderNotification({
      supabase,
      lookup: { orderNumber: publicOrderNumber },
      kind: "created",
    });
    emailRecipient = notification.recipient;
  } catch (notificationError) {
    console.error(
      `Order confirmation email failed for ${publicOrderNumber}:`,
      notificationError,
    );
    emailWarning =
      "A rendelés sikeresen létrejött, de a visszaigazoló e-mailt nem sikerült elküldeni.";
  }

  return {
    success: true,
    orderNumber: publicOrderNumber,
    emailWarning,
    emailRecipient,
  };
}
