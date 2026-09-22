import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getMaintenanceConfig } from "@/lib/maintenance/config";
import MaintenanceSettingsForm from "@/components/admin/MaintenanceSettingsForm";

export default async function AdminMaintenancePage() {
    const currentUser = await getCurrentUser();
    if (!currentUser?.isSuperAdmin) redirect("/admin/accounts");

    const config = await getMaintenanceConfig();

    return (
        <div className="mx-auto w-full max-w-3xl">
            <h1 className="sr-only">Fiók / Karbantartás</h1>
            <div className="px-4 text-center sm:px-6">
                <p className="mx-auto mt-2.5 max-w-3xl text-base leading-7 text-gray-600 italic">
                    A weboldal globális karbantartási módjának be- és kikapcsolása, valamint a látogatóknak megjelenő tájékoztató üzenet szerkesztése.
                </p>
            </div>
            <div className="mt-6">
                <MaintenanceSettingsForm initialConfig={config} />
            </div>
        </div>
    );
}
