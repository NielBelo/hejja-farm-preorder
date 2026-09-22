"use client";

import type { ReactNode } from "react";
import { useMaintenanceState } from "./MaintenanceStateProvider";
import MaintenanceOverlay from "./MaintenanceOverlay";

// Amikor a karbantartás blokkolja a felhasználót, az eredeti oldaltartalmat
// teljesen leválasztja (nem csak vizuálisan eltakarja) és a
// MaintenanceOverlay-jel helyettesíti. Ez a React unmount biztosítja, hogy
// egy már nyitott oldalon folyamatban lévő interakció (pl. egy rendelési
// űrlap gombja) ne maradhasson a DOM-ban és ne tudja megkerülni a frissen
// érzékelt blokkolást – a beküldés-kezelő referenciájával együtt megszűnik.
export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const { blocked, message, endsAt } = useMaintenanceState();

  if (blocked) {
    return <MaintenanceOverlay message={message ?? ""} endsAt={endsAt} />;
  }

  return <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>;
}
