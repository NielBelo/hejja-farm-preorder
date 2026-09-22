"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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

const POLL_INTERVAL_MS = 30_000;

// Egyetlen, megosztott pollozás vezérli mind a fejléc letiltó rétegét, mind
// a tartalom karbantartási felületre cserélését, hogy már nyitott oldalakon
// is – frissítés/navigáció nélkül – érvénybe lépjen egy időközben aktivált
// (vagy visszavont) karbantartás. Csak akkor kérdez, amíg a fül aktív, és
// rögtön újraellenőriz, amint a fül újra láthatóvá válik. A pollozás
// mindkét irányban életben marad (nem áll le blokkolás után), hogy a
// superadmin által kikapcsolt karbantartás, vagy az admin bypass
// visszaengedélyezése is automatikusan helyreállítsa a normál oldalt.
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
  const [state, setState] = useState<MaintenanceState>({
    blocked: initialBlocked,
    message: initialMessage,
    endsAt: initialEndsAt,
  });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/maintenance-status", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled) return;

        setState(
          data?.blocked
            ? {
                blocked: true,
                message: typeof data.message === "string" ? data.message : null,
                endsAt: typeof data.endsAt === "string" ? data.endsAt : null,
              }
            : { blocked: false, message: null, endsAt: null }
        );
      } catch {
        // Hálózati hiba esetén a következő ütemezett vagy visibility-alapú
        // próbálkozás úgyis újra megkísérli, nincs szükség külön kezelésre.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") check();
    }

    const intervalId = window.setInterval(check, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return <MaintenanceContext.Provider value={state}>{children}</MaintenanceContext.Provider>;
}
