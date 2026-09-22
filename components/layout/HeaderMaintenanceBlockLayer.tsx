"use client";

import { useMaintenanceState } from "./MaintenanceStateProvider";

// Karbantartáskor a fejléc látszik, de nem használható: ez a réteg a
// sticky headerrel együtt mozog és minden interakciót elnyel. A blokkolt
// állapotot a megosztott MaintenanceStateProvider szolgáltatja, így ez a
// réteg akkor is életbe lép, ha a karbantartás egy már nyitott oldalon,
// pollozás közben válik aktívvá – nem csak kezdeti betöltéskor.
export default function HeaderMaintenanceBlockLayer() {
  const { blocked } = useMaintenanceState();
  if (!blocked) return null;

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-10 cursor-not-allowed rounded-xl"
    />
  );
}
