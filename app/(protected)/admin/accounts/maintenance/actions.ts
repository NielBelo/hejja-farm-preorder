"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getKv, setMaintenanceConfig, type MaintenanceConfig } from "@/lib/maintenance/config";
import { writeSeasonLaunchSwitch } from "@/lib/email/seasonLaunchSwitch";
import { writeReminderSwitch } from "@/lib/email/reminderSwitch";

export type MaintenanceConfigInput = {
    active: boolean;
    endsAt: string | null;
    message: string;
    adminBypass: boolean;
};

export async function updateMaintenanceConfig(input: MaintenanceConfigInput) {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isSuperAdmin) {
        return { success: false as const, error: "Superadmin jogosultság szükséges." };
    }

    const message = typeof input?.message === "string" ? input.message.trim() : "";
    if (!message) return { success: false as const, error: "A tájékoztató üzenet nem lehet üres." };
    if (message.length > 2000) return { success: false as const, error: "A tájékoztató üzenet túl hosszú (max. 2000 karakter)." };

    const endsAt = typeof input?.endsAt === "string" && input.endsAt ? input.endsAt : null;
    if (endsAt && Number.isNaN(new Date(endsAt).getTime())) return { success: false as const, error: "Érvénytelen befejezési időpont." };

    const config: MaintenanceConfig = {
        active: Boolean(input?.active),
        endsAt,
        message,
        adminBypass: input?.adminBypass !== false,
    };

    const saved = await setMaintenanceConfig(config);
    if (!saved) {
        return { success: false as const, error: "A beállítások mentése sikertelen. Kérjük, próbálja újra." };
    }

    revalidatePath("/", "layout");
    return { success: true as const, config };
}

// A szezonindítási értesítő automatikus küldésének be-/kikapcsolása. Csak
// superadmin. Magát a küldést a worker a szezon kezdőnapján 08:00-kor végzi.
export async function updateSeasonLaunchSwitch(enabled: boolean) {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isSuperAdmin) {
        return { success: false as const, error: "Superadmin jogosultság szükséges." };
    }

    const saved = await writeSeasonLaunchSwitch(await getKv(), enabled === true, currentUser.email);
    if (!saved) {
        return { success: false as const, error: "A kapcsoló mentése sikertelen. Kérjük, próbálja újra." };
    }

    revalidatePath("/admin/accounts/maintenance");
    return { success: true as const, state: saved };
}

// Az átvételi emlékeztetők automatikus küldésének be-/kikapcsolása. Csak
// superadmin. A küldést a worker minden nap 08:00-kor (budapesti idő) végzi.
export async function updateReminderSwitch(enabled: boolean) {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isSuperAdmin) {
        return { success: false as const, error: "Superadmin jogosultság szükséges." };
    }

    const saved = await writeReminderSwitch(await getKv(), enabled === true, currentUser.email);
    if (!saved) {
        return { success: false as const, error: "A kapcsoló mentése sikertelen. Kérjük, próbálja újra." };
    }

    revalidatePath("/admin/accounts/maintenance");
    return { success: true as const, state: saved };
}
