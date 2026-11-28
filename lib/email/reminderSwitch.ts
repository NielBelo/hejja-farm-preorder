import "server-only";
import {
    readSendingSwitch,
    writeSendingSwitch,
    type SendingSwitch,
    type SendingSwitchKv,
} from "@/lib/email/sendingSwitch";

// Az átvételi emlékeztető küldésének kapcsolója (KV, superadmin kezeli).
export type ReminderSwitch = SendingSwitch;

export const REMINDER_SWITCH_KEY = "reminder-sending";

// Átmenet a korábbi, környezeti változós kapcsolóról: amíg a superadmin még
// SOHA nem módosította a kapcsolót (nincs KV-érték), a régi
// REMINDER_EMAIL_SENDING_ENABLED beállítás érvényes marad - így a váltás
// nem állítja le váratlanul az éles emlékeztetőket. Az első módosítástól a
// KV értéke dönt. Elérhetetlen KV esetén KIKAPCSOLT (biztonságos irány).
export async function resolveReminderSending(
    kv: SendingSwitchKv | null | undefined,
    legacyEnvFlag: string | undefined,
): Promise<{ state: ReminderSwitch; inheritedFromEnv: boolean }> {
    const { state, status } = await readSendingSwitch(kv, REMINDER_SWITCH_KEY);
    if (status === "set") return { state, inheritedFromEnv: false };
    if (status === "unset") return { state: { ...state, enabled: legacyEnvFlag === "true" }, inheritedFromEnv: true };
    return { state, inheritedFromEnv: false };
}

// A küldési utak (lib/email/reminderGuard.ts) szinkron, process.env alapú
// guardot használnak, ezért a worker minden belépési pontján (napi futás és
// minden csomag) a KV-ból feloldott állapotot ide írjuk, a guard ELŐTT.
export async function applyReminderSwitchToEnv(kv: SendingSwitchKv | null | undefined): Promise<boolean> {
    const { state } = await resolveReminderSending(kv, process.env.REMINDER_EMAIL_SENDING_ENABLED);
    process.env.REMINDER_EMAIL_SENDING_ENABLED = state.enabled ? "true" : "false";
    return state.enabled;
}

export function writeReminderSwitch(
    kv: SendingSwitchKv | null | undefined,
    enabled: boolean,
    updatedBy: string,
    now?: Date,
): Promise<ReminderSwitch | null> {
    return writeSendingSwitch(kv, REMINDER_SWITCH_KEY, enabled, updatedBy, now);
}
