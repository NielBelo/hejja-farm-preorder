"use server";

import { createClient } from "@/lib/supabase/server";
import { sendOrderNotification } from "@/lib/email/sendOrderNotification";

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

  const { data: orderNumber, error } = await supabase.rpc("finalize_order", {
    p_season_parameter_id: data.seasonParameterId,
    p_pickup_day_id: data.pickupDayId,
    p_items: data.items,
  });

  if (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  const publicOrderNumber = String(orderNumber);
  let emailWarning: string | undefined;

  try {
    await sendOrderNotification({
      supabase,
      lookup: { orderNumber: publicOrderNumber },
      kind: "created",
    });
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
  };
}
