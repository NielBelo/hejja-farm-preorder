import { createClient } from "@/lib/supabase/server";
import AdminOrderList from "@/components/admin/AdminOrderList";
import type { AdminOrder } from "@/components/admin/AdminOrderCard";
import { OrderActionsManager } from "@/components/OrderActionsManager";


export default async function AdminOrdersPage() {
    const supabase = await createClient();

    // ------------------------------------------------------------
    // Mai dátum
    // ------------------------------------------------------------
    const today = new Date().toISOString().split("T")[0];

    // ------------------------------------------------------------
    // Aktuális rendelések
    // ------------------------------------------------------------
    const { data: orders, error } = await supabase
        .from("orders")
        .select(`
            id,
            public_order_number,
            status,
            created_at,
            current_version_id,
            user_id,
            pickup_day_id,

            pickup_days!orders_pickup_day_id_fkey!inner (
                id,
                pickup_date,
                serial_number,
                available_stock,
                planned_stock
            ),

            order_versions!orders_current_version_id_fkey (
                id,
                version_number,
                created_at,

                order_items (
                    id,
                    product_id,
                    package_id,
                    quantity,
                    size_preference,
                    note,

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
        .eq("status", "submitted")
        .gte("pickup_days.pickup_date", today)
        .order("created_at", { ascending: false });

    if (error) {
        throw new Error(error.message);
    }

    const typedOrders = (orders ?? []) as unknown as AdminOrder[];

    // ------------------------------------------------------------
    // A rendelésekhez tartozó felhasználók
    // ------------------------------------------------------------
    const userIds = [
        ...new Set(
            typedOrders.map((order) => order.user_id)
        ),
    ];

    let profiles: {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        city: string;
        county: string | null;
    }[] = [];

    if (userIds.length > 0) {
        const {
            data: profileData,
            error: profilesError,
        } = await supabase
            .from("profiles")
            .select(`
                id,
                first_name,
                last_name,
                email,
                phone,
                city,
                county
            `)
            .in("id", userIds);

        if (profilesError) {
            throw new Error(profilesError.message);
        }

        profiles = profileData ?? [];
    }

    // ------------------------------------------------------------
    // Profile Map
    // ------------------------------------------------------------
    const profileMap = new Map(
        profiles.map((profile) => [
            profile.id,
            profile,
        ])
    );

    // ------------------------------------------------------------
    // Profil hozzárendelése a rendelésekhez
    // ------------------------------------------------------------
    const ordersWithProfiles: AdminOrder[] =
        typedOrders.map((order) => ({
            ...order,
            profile:
                profileMap.get(order.user_id) ?? null,
        }));

    // ------------------------------------------------------------
    // Teljes terméklista a későbbi admin szerkesztéshez
    // ------------------------------------------------------------
    const {
        data: products,
        error: productsError,
    } = await supabase
        .from("products")
        .select(`
            id,
            name,
            description,
            image_url
        `)
        .order("name");

    if (productsError) {
        throw new Error(productsError.message);
    }

    // ------------------------------------------------------------
    // Teljes csomagoláslista a későbbi admin szerkesztéshez
    // ------------------------------------------------------------
    const {
        data: packages,
        error: packagesError,
    } = await supabase
        .from("packages")
        .select(`
            id,
            name,
            description
        `)
        .order("name");

    if (packagesError) {
        throw new Error(packagesError.message);
    }

    // ------------------------------------------------------------
    // Oldal
    // ------------------------------------------------------------
    return (
        <div className="mx-auto w-full max-w-5xl">
            <h1 className="text-2xl font-semibold text-gray-800">
                Rendelések
            </h1>

            {ordersWithProfiles.length === 0 ? (
                <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-500 shadow-sm">
                    Nincs megjeleníthető rendelés.
                </div>
            ) : (
                <div className="mt-6">
                    <OrderActionsManager>
                        <AdminOrderList
                            orders={ordersWithProfiles}
                            products={products ?? []}
                            packages={packages ?? []}
                        />
                    </OrderActionsManager>
                </div>
            )}
        </div>
    );
}