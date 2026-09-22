import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { buildMaintenanceStatusPayload, getMaintenanceConfig } from "@/lib/maintenance/config";

// Kliensoldali pollozáshoz: az éppen bejelentkezett felhasználóra (vagy
// vendégre) nézve visszaadja, hogy a karbantartási mód blokkolja-e. Ugyanazt
// a getCurrentUser()/getMaintenanceConfig()/isMaintenanceBlocking() logikát
// használja, mint a szerveroldali layout-kapu, nincs duplikált szabály.
export async function GET() {
    const [currentUser, config] = await Promise.all([getCurrentUser(), getMaintenanceConfig()]);

    return NextResponse.json(buildMaintenanceStatusPayload(config, currentUser), {
        headers: { "Cache-Control": "no-store" },
    });
}
