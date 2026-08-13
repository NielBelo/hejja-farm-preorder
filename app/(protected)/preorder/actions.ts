"use server";

import { createClient } from "@/lib/supabase/server";

export type SubmitOrderItem = {
  productId: number;
  packageId: number;
  quantity: number;
  note: string;
};

export type SubmitOrderData = {
  seasonParameterId: number;
  pickupDayId: number;
  items: SubmitOrderItem[];
};

export async function submitOrder(data: SubmitOrderData) {
  const supabase = await createClient();

  // Bejelentkezett felhasználó
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

  // Rendelés létrehozása
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      season_parameter_id: data.seasonParameterId,
      pickup_day_id: data.pickupDayId,
    })
    .select("id")
    .single();

  if (orderError) {
    return {
      success: false,
      error: orderError.message,
    };
  }

  // Tételek létrehozása
  const items = data.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    package_id: item.packageId,
    quantity: item.quantity,
    note: item.note,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(items);

  if (itemsError) {
    return {
      success: false,
      error: itemsError.message,
    };
  }

  return {
    success: true,
  };
}