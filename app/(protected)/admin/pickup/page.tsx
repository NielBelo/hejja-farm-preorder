import PickupSheet from "@/components/admin/PickupSheet";
import { createClient } from "@/lib/supabase/server";
import {
    getPickupDateOptions,
    normalizePickupDate,
    sortPickupOrders,
    type PickupSheetItem,
    type PickupSheetOrder,
    type PickupSheetPickupDay,
} from "@/lib/pickupSheet";

type RawOrder = {
    id: number;
    public_order_number: string;
    user_id: string;
    pickup_days: { pickup_date: string } | null;
    current_version: { order_items: PickupSheetItem[] } | null;
};

export default async function AdminPickupPage() {
    const supabase = await createClient();
    const [ordersResult, pickupDaysResult] = await Promise.all([
        supabase
            .from("orders")
            .select(`
                id,
                public_order_number,
                user_id,
                pickup_days!orders_pickup_day_id_fkey!inner (pickup_date),
                current_version:order_versions!orders_current_version_id_fkey (
                    order_items (
                        id,
                        quantity,
                        size_preference,
                        note,
                        products (name),
                        packages (name)
                    )
                )
            `)
            .eq("status", "submitted"),
        supabase
            .from("pickup_days")
            .select("pickup_date, planned_stock, available_stock")
            .eq("is_active", true)
            .order("pickup_date", { ascending: true }),
    ]);

    if (ordersResult.error) throw new Error(ordersResult.error.message);
    if (pickupDaysResult.error) throw new Error(pickupDaysResult.error.message);

    const rawOrders = (ordersResult.data ?? []) as unknown as RawOrder[];
    const userIds = [...new Set(rawOrders.map((order) => order.user_id))];
    const { data: profiles, error: profileError } = userIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, first_name, last_name, phone")
            .in("id", userIds)
        : { data: [], error: null };

    if (profileError) throw new Error(profileError.message);

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const orders = sortPickupOrders(rawOrders.map<PickupSheetOrder>((order) => {
        const profile = profileMap.get(order.user_id);
        return {
            id: order.id,
            public_order_number: order.public_order_number,
            user_id: order.user_id,
            pickupDate: normalizePickupDate(order.pickup_days?.pickup_date ?? ""),
            customerName: [profile?.last_name, profile?.first_name]
                .filter(Boolean).join(" ").trim() || "Ismeretlen vásárló",
            phone: profile?.phone ?? "—",
            items: order.current_version?.order_items ?? [],
        };
    }));
    const pickupDates = getPickupDateOptions(
        (pickupDaysResult.data ?? []) as PickupSheetPickupDay[]
    );

    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="print-hidden px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    <span className="block">Válassza ki az átvételi napot az aktív előrendelések, valamint az aznapi mennyiségek és eloszlások áttekintéséhez.</span>
                    <span className="mt-0.5 block">Az előkészített átvételi listát közvetlenül kinyomtathatja vagy PDF-ként mentheti.</span>
                </p>
            </div>
            <div className="mt-6 print:mt-0">
                <PickupSheet orders={orders} pickupDates={pickupDates} />
            </div>
        </div>
    );
}
