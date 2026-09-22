import { getCloudflareContext } from "@opennextjs/cloudflare";

export type MaintenanceConfig = {
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  message: string;
  adminBypass: boolean;
};

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Kedves vásárlónk, a weboldalon karbantartás zajlik, kérjük látogasson vissza később!";

const KV_KEY = "maintenance-config";

const DEFAULT_CONFIG: MaintenanceConfig = {
  active: false,
  startsAt: null,
  endsAt: null,
  message: DEFAULT_MAINTENANCE_MESSAGE,
  adminBypass: true,
};

// A projekt nem függ a @cloudflare/workers-types csomagtól, ezért a
// KVNamespace típus helyett csak a ténylegesen használt metódusokat írjuk le.
type MinimalKvNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

async function getKv(): Promise<MinimalKvNamespace | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as unknown as { MAINTENANCE_KV?: MinimalKvNamespace })
      .MAINTENANCE_KV;
    return kv ?? null;
  } catch (error) {
    console.error("Karbantartási KV elérési hiba:", error);
    return null;
  }
}

function normalizeConfig(raw: unknown): MaintenanceConfig {
  const parsed = (raw ?? {}) as Partial<MaintenanceConfig>;
  return {
    active: Boolean(parsed.active),
    startsAt: typeof parsed.startsAt === "string" ? parsed.startsAt : null,
    endsAt: typeof parsed.endsAt === "string" ? parsed.endsAt : null,
    message:
      typeof parsed.message === "string" && parsed.message.trim()
        ? parsed.message
        : DEFAULT_MAINTENANCE_MESSAGE,
    adminBypass: parsed.adminBypass !== false,
  };
}

// A karbantartási beállítások lekérése. Ha a KV nem elérhető (pl. hiányzó
// binding, helyi fejlesztői környezet) vagy a beolvasás hibázik, biztonságos
// alapértelmezésként inaktív karbantartást adunk vissza – egy infrastruktúra
// hiba miatt nem szabad véletlenül minden látogatót kizárni.
export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const kv = await getKv();
  if (!kv) return DEFAULT_CONFIG;

  try {
    const raw = await kv.get(KV_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    console.error("Karbantartási beállítások beolvasási hiba:", error);
    return DEFAULT_CONFIG;
  }
}

export async function setMaintenanceConfig(
  config: MaintenanceConfig
): Promise<boolean> {
  const kv = await getKv();
  if (!kv) return false;

  try {
    await kv.put(KV_KEY, JSON.stringify(normalizeConfig(config)));
    return true;
  } catch (error) {
    console.error("Karbantartási beállítások mentési hiba:", error);
    return false;
  }
}

// Eldönti, hogy egy adott felhasználó számára aktívan blokkolnia kell-e a
// karbantartási módnak. A superadmin sosincs blokkolva; az admin csak akkor
// fér hozzá, ha a "admin bypass" beállítás engedélyezve van; mindenki más
// (vendég, sima vásárló) mindig blokkolva van, amíg a karbantartás aktív.
export function isMaintenanceBlocking(
  config: MaintenanceConfig,
  currentUser: { isAdmin: boolean; isSuperAdmin: boolean } | null
): boolean {
  if (!config.active) return false;
  if (currentUser?.isSuperAdmin) return false;
  if (currentUser?.isAdmin && config.adminBypass) return false;
  return true;
}
