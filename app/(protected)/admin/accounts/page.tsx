import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";
import type { AdminAccount } from "@/lib/adminAccountData";
import AdminAccountList from "@/components/admin/AdminAccountList";

export default async function AdminAccountsPage() {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isAdmin) redirect("/preorder");

    const supabase = await createClient();
    const accounts: AdminAccount[] = [];
    let failed = false;
    // A teljes lista lapozva töltődik, nem vágja le a PostgREST sorlimitje.
    for (let offset = 0; ; offset += 200) {
        const { data, error } = await supabase.rpc("get_admin_accounts", { page_offset: offset, page_size: 200 });
        if (error || !Array.isArray(data)) {
            console.error("Admin fióklista betöltési hiba", error?.code);
            failed = true;
            break;
        }
        accounts.push(...data as AdminAccount[]);
        if (data.length < 200) break;
    }
    accounts.sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""} ${a.email ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""} ${b.email ?? ""}`, "hu"));

    return (
        <div className="mx-auto w-full max-w-5xl">
            <h1 className="sr-only">Fiók / Szerkesztés</h1>
            <div className="px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-3xl text-base leading-7 text-gray-600 italic">
                    Tekintse át és szűrje a felhasználói fiókokat és a meghívottakat, majd nyissa le a kártyákat a személyes adatokhoz, a meghívásokhoz és a regisztráció előzményeihez.
                </p>
            </div>
            <div className="mt-6">
                {failed ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                    A felhasználók betöltése sikertelen. Kérjük, próbálja újra az oldal frissítésével. Ha a hiba továbbra is fennáll, jelezze az üzemeltetőnek.
                </div> : <AdminAccountList accounts={accounts} />}
            </div>
        </div>
    );
}
