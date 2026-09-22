import Header from "@/components/layout/Header";
import MaintenanceOverlay from "@/components/layout/MaintenanceOverlay";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getMaintenanceConfig, isMaintenanceBlocking } from "@/lib/maintenance/config";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentUser, maintenanceConfig] = await Promise.all([
    getCurrentUser(),
    getMaintenanceConfig(),
  ]);
  const blocked = isMaintenanceBlocking(maintenanceConfig, currentUser);

  return (
    <>
      <Header blocked={blocked} />

      {blocked ? (
        <MaintenanceOverlay config={maintenanceConfig} />
      ) : (
        <main className="max-w-6xl mx-auto px-4 py-6">
          {children}
        </main>
      )}
    </>
  );
}