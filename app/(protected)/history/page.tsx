import { createClient } from "@/lib/supabase/server";
import OrderActions from "@/components/OrderActions";

type OrderItem = {
  id: number;
  quantity: number;
  note: string | null;
  size_preference: string | null;
  products: {
    id: number;
    name: string;
  } | null;
  packages: {
    id: number;
    name: string;
  } | null;
};

type Order = {
  id: number;
  public_order_number: string;
  status: string;
  created_at: string;
  pickup_day_id: number;
  current_version_id: number;
  pickup_days: {
    id: number;
    pickup_date: string;
  } | null;
  current_version: {
    id: number;
    version_number: number;
    order_items: OrderItem[];
  } | null;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export default async function HistoryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("orders")
    .select(`
            id,
            public_order_number,
            status,
            created_at,
            pickup_day_id,
            current_version_id,

            pickup_days (
                id,
                pickup_date
            ),

            current_version:order_versions!orders_current_version_id_fkey (
                id,
                version_number,

                order_items (
                    id,
                    quantity,
                    note,
                    size_preference,

                    products (
                        id,
                        name
                    ),

                    packages (
                        id,
                        name
                    )
                )
            )
        `)
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("History query error:", error);

    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm text-red-600">
          Hiba történt a rendelések betöltése közben.
        </p>
      </div>
    );
  }

  const orders = (data ?? []) as unknown as Order[];

  const now = new Date();

  return (
    <main className="mx-auto mt-4 w-full max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-800">
          Előzmények
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Korábbi és aktuális előrendelései
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">
            Még nincs korábbi rendelése.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {orders.map((order) => {
            const pickupDate = order.pickup_days?.pickup_date;

            const isCurrent =
              !!pickupDate &&
              new Date(pickupDate) >= now;

            const items =
              order.current_version?.order_items ?? [];

            const totalQuantity = items.reduce(
              (sum, item) => sum + item.quantity,
              0
            );

            return (
              <div
                key={order.id}
                className="
                                    overflow-hidden rounded-xl
                                    border border-gray-200
                                    bg-white shadow-sm
                                "
              >
                {/* Fejléc */}
<div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">

  {/* Rendelési azonosító - bal oldal */}
  <span className="text-lg font-semibold text-gray-800">
    Rendelési azonosító:{" "}
    {order.public_order_number}
  </span>

  {/* Aktualitás - jobb oldal */}
  <div className="flex items-center gap-3">
    <span
      className={`
        h-2.5 w-2.5 rounded-full
        ${
          isCurrent
            ? "bg-[rgb(49,171,2)]"
            : "bg-gray-300"
        }
      `}
    />

    <span
      className={`
        text-xs font-semibold uppercase tracking-wide
        ${
          isCurrent
            ? "text-[rgb(49,171,2)]"
            : "text-gray-400"
        }
      `}
    >
      {isCurrent ? "Aktuális" : "Teljesített"}
    </span>
  </div>

</div>

                {/* Tartalom */}
                <div className="px-5 pb-4 pt-1">

                  {/* Rendelési dátumok */}
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b-4 border-double border-gray-200 pb-2">
                    

                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="text-gray-800">
                        Rendelés kelte:
                      </span>

                      <span className="text-gray-800">
                        {formatDate(order.created_at)}
                      </span>
                    </div>


                    <div className="flex items-baseline gap-2">
                      <span className="text-sm text-gray-800">
                        Átvétel:
                      </span>

                      <span className=" text-sm text-gray-800">
                        {pickupDate
                          ? formatDate(pickupDate)
                          : "Nincs megadva"}
                      </span>
                    </div>
                  </div>

                  {/* Tételek */}
                  <div className="divide-y divide-gray-200">
                    {items.map((item, index) => (
                      <div
                        key={item.id}
                        className="py-3 first:pt-0 last:pb-0"
                      >
                        {/* 1. sor: termék + mennyiség */}
                        <p className="font-medium text-sm text-gray-800">
                          <span className="mr-2 font-medium text-gray-800">
                            {index + 1}. tétel:
                          </span>

                          {item.products?.name ?? "Ismeretlen termék"}{" "}
                          {item.quantity} db
                        </p>

                        {/* 2. sor: részletek */}
                        <p className="mt-1 text-sm text-gray-500">
                          {item.packages?.name ?? "Nincs csomagolás"}

                          {item.size_preference && (
                            <>
                              <span className="mx-2 text-gray-500">·</span>
                              {item.size_preference}
                            </>
                          )}

                          {item.note && (
                            <>
                              <span className="mx-2 text-gray-500">·</span>
                              <span>
                                Megjegyzés: {item.note}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Összesítés + műveletek */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3">
                    <div className="text-sm">
                      <span className="font-medium text-gray-800 ">
                        Összesen:
                      </span>{" "}
                      <span className="font-medium text-gray-800">
                        {totalQuantity} db
                      </span>
                    </div>

                    {isCurrent && (
  <OrderActions
    orderId={order.id}
    publicOrderNumber={order.public_order_number}
  />
)}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}