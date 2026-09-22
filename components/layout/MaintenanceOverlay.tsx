import { WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import type { MaintenanceConfig } from "@/lib/maintenance/config";

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

export default function MaintenanceOverlay({
  config,
}: {
  config: MaintenanceConfig;
}) {
  const endsAt = formatDateTime(config.endsAt);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-2xl flex-col items-center justify-center px-4 py-10">
      <div className="w-full rounded-xl border border-gray-100 bg-white p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(216,227,232,0.51)]">
          <WrenchScrewdriverIcon
            aria-hidden="true"
            className="h-8 w-8 text-[rgb(49,171,2)]"
          />
        </div>

        <h1 className="mt-6 text-xl font-semibold text-gray-800 sm:text-2xl">
          Karbantartás
        </h1>

        <p className="mt-4 whitespace-pre-line text-base leading-7 text-gray-600">
          {config.message}
        </p>

        {endsAt && (
          <dl className="mt-8 border-t border-gray-100 pt-6 text-sm text-gray-500">
            <dt className="font-medium text-gray-400">Tervezett befejezés:</dt>
            <dd className="mt-1 text-gray-700">{endsAt}</dd>
          </dl>
        )}
      </div>
    </main>
  );
}
