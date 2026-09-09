"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateAccountProfile } from "@/lib/adminAccountEdit";

export async function updateAdminAccount(userId: string, input: unknown) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false as const, error: "A mentéshez jelentkezzen be újra." };
    const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (roleError || !role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges." };
    if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        return { success: false as const, error: "Érvénytelen felhasználó." };
    }
    const validated = validateAccountProfile(input);
    if (validated.error) return { success: false as const, error: validated.error };
    const { data, error } = await supabase.rpc("update_admin_account_profile", {
        target_user_id: userId,
        profile_data: validated.profile,
    });
    if (error || !data) {
        return { success: false as const, error: "A személyes adatok mentése sikertelen. Kérjük, próbálja újra." };
    }
    revalidatePath("/admin/accounts");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/pickup");
    revalidatePath("/profile");
    return { success: true as const, profile: validated.profile! };
}
