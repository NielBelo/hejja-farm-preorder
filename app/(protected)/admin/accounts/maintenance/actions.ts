"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { setMaintenanceConfig, type MaintenanceConfig } from "@/lib/maintenance/config";

export type MaintenanceConfigInput = {
    active: boolean;
    startsAt: string | null;
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

    const startsAt = typeof input?.startsAt === "string" && input.startsAt ? input.startsAt : null;
    const endsAt = typeof input?.endsAt === "string" && input.endsAt ? input.endsAt : null;
    if (startsAt && Number.isNaN(new Date(startsAt).getTime())) return { success: false as const, error: "Érvénytelen kezdési időpont." };
    if (endsAt && Number.isNaN(new Date(endsAt).getTime())) return { success: false as const, error: "Érvénytelen befejezési időpont." };
    if (startsAt && endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
        return { success: false as const, error: "A karbantartás vége nem lehet korábbi, mint a kezdete." };
    }

    const config: MaintenanceConfig = {
        active: Boolean(input?.active),
        startsAt,
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
