import { createClient } from "@/lib/supabase/server";
import AdminOrderList from "@/components/admin/AdminOrderList";
import { OrderActionsManager } from "@/components/OrderActionsManager";
import {
    getAdminOrdersByPickupDayIds,
    getAdminSeasonOptions,
} from "@/lib/adminOrderData";
import { getDefaultAdminSeason } from "@/lib/adminOrderFilters";


export default async function AdminOrdersPage() {
    const supabase = await createClient();

    // ------------------------------------------------------------
    // A teljes szezonlista könnyű metaadat-lekérése. A részletes
    // rendelésekből elsőre csak az alapértelmezett szezon töltődik.
    // ------------------------------------------------------------
    const seasonOptions = await getAdminSeasonOptions(supabase);
    const defaultSeason = getDefaultAdminSeason(seasonOptions);
    const [initialOrders, productsResult, packagesResult, pickupDaysResult] = await Promise.all([
        defaultSeason
            ? getAdminOrdersByPickupDayIds(supabase, defaultSeason.pickupDayIds)
            : Promise.resolve([]),
        supabase
            .from("products")
            .select("id, name, description, image_url")
            .order("name"),
        supabase
            .from("packages")
            .select("id, name, description")
            .order("name"),
        // Admin számára minden átvételi nap (aktív és inaktív is) megjelenik -
        // az admin bármely rendelést bármely napra áthelyezhet, illetve az
        // adott rendelés jelenlegi (esetleg inaktív) napjának is szerepelnie
        // kell a listában, különben a "jelenlegi választás" megjelenítése és
        // a nap szerinti keresés hibásan üresre futna. Az Előzmények oldal
        // ezzel szemben szándékosan csak az aktív napokat kínálja fel.
        supabase
            .from("pickup_days")
            .select("*")
            .order("_group")
            .order("serial_number"),
    ]);

    if (productsResult.error) {
        throw new Error(productsResult.error.message);
    }
    if (packagesResult.error) {
        throw new Error(packagesResult.error.message);
    }
    if (pickupDaysResult.error) {
        throw new Error(pickupDaysResult.error.message);
    }

    // ------------------------------------------------------------
    // Oldal
    // ------------------------------------------------------------
    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-3xl text-base leading-7 text-gray-600 italic">
                    Tekintse át és szűrje a leadott előrendeléseket, majd nyissa le a részleteket a vásárlói adatokhoz, előzményekhez és kezelési lehetőségekhez.
                </p>
            </div>

            <div className="mt-6">
                <OrderActionsManager>
                    <AdminOrderList
                        initialOrders={initialOrders}
                        initialSeason={defaultSeason?.value ?? ""}
                        seasonOptions={seasonOptions.map(({ value, label }) => ({ value, label }))}
                        products={productsResult.data ?? []}
                        packages={packagesResult.data ?? []}
                        pickupDays={pickupDaysResult.data ?? []}
                    />
                </OrderActionsManager>
            </div>
        </div>
    );
}
