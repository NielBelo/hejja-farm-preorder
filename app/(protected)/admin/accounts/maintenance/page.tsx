import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getKv, getMaintenanceConfig } from "@/lib/maintenance/config";
import { readSeasonLaunchSwitch } from "@/lib/email/seasonLaunchSwitch";
import { resolveReminderSending } from "@/lib/email/reminderSwitch";
import MaintenanceSettingsForm from "@/components/admin/MaintenanceSettingsForm";
import SendingSwitchCard from "@/components/admin/SendingSwitchCard";

export default async function AdminMaintenancePage() {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isSuperAdmin) redirect("/admin/accounts");

    const config = await getMaintenanceConfig();
    const kv = await getKv();
    const seasonLaunchSwitch = await readSeasonLaunchSwitch(kv);
    const reminder = await resolveReminderSending(kv, process.env.REMINDER_EMAIL_SENDING_ENABLED);

    return (
        <div className="mx-auto w-full max-w-3xl">
            <h1 className="sr-only">Fiók / Karbantartás</h1>
            <div className="px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-3xl text-base leading-7 text-gray-600 italic">
                    A weboldal globális karbantartási módjának be- és kikapcsolása, valamint a látogatóknak megjelenő tájékoztató üzenet szerkesztése. Alatta az automatikus e-mail-küldések kapcsolói találhatók.
                </p>
            </div>
            <div className="mt-6">
                <MaintenanceSettingsForm initialConfig={config} />
            </div>
            <div className="mt-6">
                <SendingSwitchCard kind="seasonLaunch" initialState={seasonLaunchSwitch} />
            </div>
            <div className="mt-6">
                <SendingSwitchCard kind="reminder" initialState={reminder.state} inheritedFromEnv={reminder.inheritedFromEnv} />
            </div>
        </div>
    );
}
