import "server-only";
import {
    readSendingSwitch,
    writeSendingSwitch,
    type SendingSwitch,
    type SendingSwitchKv,
} from "@/lib/email/sendingSwitch";

// A szezonindítási értesítő küldésének kapcsolója (KV, superadmin kezeli).
// Alapállapot: KIKAPCSOLVA - hiányzó kulcs, elérhetetlen KV vagy érvénytelen
// érték esetén sem mehet ki levél.
export type SeasonLaunchSwitch = SendingSwitch;
export type SeasonLaunchSwitchKv = SendingSwitchKv;

export const SEASON_LAUNCH_SWITCH_KEY = "season-launch-sending";

export async function readSeasonLaunchSwitch(kv: SeasonLaunchSwitchKv | null | undefined): Promise<SeasonLaunchSwitch> {
    return (await readSendingSwitch(kv, SEASON_LAUNCH_SWITCH_KEY)).state;
}

export function writeSeasonLaunchSwitch(
    kv: SeasonLaunchSwitchKv | null | undefined,
    enabled: boolean,
    updatedBy: string,
    now?: Date,
): Promise<SeasonLaunchSwitch | null> {
    return writeSendingSwitch(kv, SEASON_LAUNCH_SWITCH_KEY, enabled, updatedBy, now);
}
