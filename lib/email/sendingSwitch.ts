import "server-only";

// Általános, KV-ban tárolt küldési kapcsoló (a szezonindítási értesítőé és az
// átvételi emlékeztetőé is erre épül). A karbantartási módhoz hasonlóan a
// MAINTENANCE_KV namespace-ben él, a superadmin a karbantartási oldalon kezeli.
export type SendingSwitch = {
    enabled: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
};

export type SendingSwitchKv = {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
};

// set: van mentett érték; unset: nincs (még nem kapcsolták); error: a KV nem
// elérhető vagy az érték olvashatatlan.
export type SendingSwitchStatus = "set" | "unset" | "error";

export const SENDING_SWITCH_OFF: SendingSwitch = { enabled: false, updatedAt: null, updatedBy: null };

function normalizeSwitch(raw: unknown): SendingSwitch {
    const parsed = (raw ?? {}) as Partial<SendingSwitch>;
    return {
        // Csak a pontos `true` kapcsol be (a "true" szöveg vagy 1 nem).
        enabled: parsed.enabled === true,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
    };
}

// Hiba esetén SOSEM kapcsol be: az állapot kikapcsolt, a status "error".
export async function readSendingSwitch(
    kv: SendingSwitchKv | null | undefined,
    key: string,
): Promise<{ state: SendingSwitch; status: SendingSwitchStatus }> {
    if (!kv) return { state: SENDING_SWITCH_OFF, status: "error" };

    try {
        const raw = await kv.get(key);
        if (!raw) return { state: SENDING_SWITCH_OFF, status: "unset" };
        return { state: normalizeSwitch(JSON.parse(raw)), status: "set" };
    } catch (error) {
        console.error(`A küldési kapcsoló (${key}) beolvasása sikertelen, kikapcsoltnak tekintjük:`, error);
        return { state: SENDING_SWITCH_OFF, status: "error" };
    }
}

export async function writeSendingSwitch(
    kv: SendingSwitchKv | null | undefined,
    key: string,
    enabled: boolean,
    updatedBy: string,
    now: Date = new Date(),
): Promise<SendingSwitch | null> {
    if (!kv) return null;

    const value: SendingSwitch = { enabled: enabled === true, updatedAt: now.toISOString(), updatedBy };
    try {
        await kv.put(key, JSON.stringify(value));
        return value;
    } catch (error) {
        console.error(`A küldési kapcsoló (${key}) mentése sikertelen:`, error);
        return null;
    }
}
