"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateAdminAccount } from "@/lib/adminAccountEdit";

export async function updateAdminAccount(userId: string, input: unknown) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false as const, error: "A mentéshez jelentkezzen be újra." };
    const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (roleError || !role) return { success: false as const, error: "Adminisztrátori jogosultság szükséges." };
    if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        return { success: false as const, error: "Érvénytelen felhasználó." };
    }
    const validated = validateAdminAccount(input);
    if (validated.error) return { success: false as const, error: validated.error };
    const { data, error } = await supabase.rpc("update_admin_account_profile", {
        target_user_id: userId,
        profile_data: validated.account,
    });
    if (error || !data) {
        return { success: false as const, error: "A személyes adatok mentése sikertelen. Kérjük, próbálja újra." };
    }
    revalidatePath("/admin/accounts");
    revalidatePath("/admin/orders");
    revalidatePath("/admin/pickup");
    revalidatePath("/profile");
    return { success: true as const, account: validated.account! };
}

export async function deleteAdminAccount(userId: string) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false as const, error: "A törléshez jelentkezzen be újra." };
    if (typeof userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return { success: false as const, error: "Érvénytelen felhasználó." };
    const { data, error } = await supabase.rpc("delete_admin_account", { target_user_id: userId });
    if (error) {
        console.error("Admin fióktörlési hiba:", error.code, error.message);
        return { success: false as const, error: error.message || "A felhasználói fiók törlése sikertelen." };
    }
    if (!data) return { success: false as const, error: "A felhasználói fiók törlése sikertelen." };
    revalidatePath("/admin/accounts");
    return { success: true as const };
}

export async function deleteAdminInvite(email: string) {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { success: false as const, error: "A törléshez jelentkezzen be újra." };
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return { success: false as const, error: "Érvénytelen e-mail-cím." };
    const { data, error } = await supabase.rpc("delete_admin_registration_invite", { target_email: normalizedEmail });
    if (error) {
        console.error("Admin meghívótörlési hiba:", error.code, error.message);
        return { success: false as const, error: error.message || "A meghívó törlése sikertelen." };
    }
    if (!data) return { success: false as const, error: "A meghívó törlése sikertelen." };
    revalidatePath("/admin/accounts");
    return { success: true as const };
}
