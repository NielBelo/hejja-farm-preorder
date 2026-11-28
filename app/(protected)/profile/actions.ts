"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAccountDeletionConfirmed } from "@/lib/accountDeletion";

export async function deleteOwnAccount(confirmation: string) {
    if (!isAccountDeletionConfirmed(confirmation)) {
        return { success: false as const, error: "A törléshez írja be a TÖRLÉS szót." };
    }

    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false as const, error: "A törléshez jelentkezzen be újra." };

    // Az admin is végigmegy a megerősítésen, és csak itt, a TÖRLÉS beírása után
    // kap érthető tájékoztatást; a tiltást az adatbázis függvény is érvényesíti.
    const { data: role } = await supabase
        .from("user_roles")
        .select("role, is_superadmin")
        .eq("user_id", user.id)
        .maybeSingle();
    if (role?.is_superadmin) {
        return { success: false as const, error: "A superadmin fiókja nem törölhető." };
    }
    if (role?.role === "admin") {
        return {
            success: false as const,
            error: "Adminisztrátorként nem törölheted a saját fiókodat. Kérj meg egy másik adminisztrátort a törlésre.",
        };
    }

    const { data, error } = await supabase.rpc("delete_own_account");
    if (error) {
        console.error("Saját fióktörlési hiba:", error.code, error.message);
        return { success: false as const, error: error.message || "A fiók törlése sikertelen." };
    }
    if (!data) return { success: false as const, error: "A fiók törlése sikertelen." };

    // A felhasználó már nem létezik; a helyi munkamenet-sütiket is töröljük.
    await supabase.auth.signOut().catch(() => undefined);
    redirect("/login");
}
