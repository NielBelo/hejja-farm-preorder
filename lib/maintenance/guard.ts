import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getMaintenanceConfig, isMaintenanceBlocking } from "@/lib/maintenance/config";

// A kliensoldali karbantartási kapu (MaintenanceGate) csak UI-szinten tiltja
// az oldalt, ezért egy karbantartás bekapcsolása előtt megnyitott, újra nem
// töltött (stale) kliens elméletileg továbbra is meghívhatná a rendeléssel
// kapcsolatos szerver actionöket. Ezt a függvényt minden ilyen mutation
// (létrehozás, módosítás, lemondás, visszaállítás) elején kötelezően meg
// kell hívni, hogy a tényleges adatbázis-módosítás előtt is érvényesüljön
// ugyanaz az admin bypass logika, mint amit a védett layout renderel.
export async function getMaintenanceBlockError(): Promise<string | null> {
  const [currentUser, config] = await Promise.all([
    getCurrentUser(),
    getMaintenanceConfig(),
  ]);

  return isMaintenanceBlocking(config, currentUser) ? config.message : null;
}
