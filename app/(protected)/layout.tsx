import Header from "@/components/layout/Header";
import MaintenanceGate from "@/components/layout/MaintenanceGate";
import MaintenanceStateProvider from "@/components/layout/MaintenanceStateProvider";
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
    <MaintenanceStateProvider
      initialBlocked={blocked}
      initialMessage={blocked ? maintenanceConfig.message : null}
      initialEndsAt={blocked ? maintenanceConfig.endsAt : null}
    >
      <Header />
      <MaintenanceGate>{children}</MaintenanceGate>
    </MaintenanceStateProvider>
  );
}