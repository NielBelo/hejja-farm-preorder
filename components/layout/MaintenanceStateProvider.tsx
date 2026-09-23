"use client";

import { createContext, useContext, type ReactNode } from "react";

type MaintenanceState = {
  blocked: boolean;
  message: string | null;
  endsAt: string | null;
};

const MaintenanceContext = createContext<MaintenanceState | null>(null);

export function useMaintenanceState(): MaintenanceState {
  const context = useContext(MaintenanceContext);
  if (!context) {
    throw new Error("useMaintenanceState csak MaintenanceStateProvideren belül használható.");
  }
  return context;
}

// A karbantartási állapotot a szerver oldali layout adja át (lásd
// app/(protected)/layout.tsx), amely minden oldalbetöltésnél/navigációnál
// frissen lekérdezi azt – admin bypass-szal együtt. Kliensoldali
// újraellenőrzés (pollozás vagy visibilitychange) szándékosan nincs: egy már
// megnyitott oldal nem hív automatikusan /api/maintenance-status végpontot.
export default function MaintenanceStateProvider({
  initialBlocked,
  initialMessage,
  initialEndsAt,
  children,
}: {
  initialBlocked: boolean;
  initialMessage: string | null;
  initialEndsAt: string | null;
  children: ReactNode;
}) {
  const state: MaintenanceState = {
    blocked: initialBlocked,
    message: initialMessage,
    endsAt: initialEndsAt,
  };

  return <MaintenanceContext.Provider value={state}>{children}</MaintenanceContext.Provider>;
}
