"use client";

import { useState } from "react";
import { BoltIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { updateMaintenanceConfig } from "@/app/(protected)/admin/accounts/maintenance/actions";
import { DEFAULT_MAINTENANCE_MESSAGE, type MaintenanceConfig } from "@/lib/maintenance/config";

function toLocalInputValue(iso: string | null): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function toggleCardClass(checked: boolean) {
    return `flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm transition-all ${checked ? "border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] text-gray-800 shadow-md" : "border-[rgba(7,109,143,0.2)] bg-white text-gray-700 hover:border-[rgb(49,171,2)] hover:bg-gray-50"}`;
}

type FormState = {
    active: boolean;
    startsAtLocal: string;
    endsAtLocal: string;
    message: string;
    adminBypass: boolean;
};

function toFormState(config: MaintenanceConfig): FormState {
    return {
        active: config.active,
        startsAtLocal: toLocalInputValue(config.startsAt),
        endsAtLocal: toLocalInputValue(config.endsAt),
        message: config.message,
        adminBypass: config.adminBypass,
    };
}

export default function MaintenanceSettingsForm({ initialConfig }: { initialConfig: MaintenanceConfig }) {
    const initial = toFormState(initialConfig);
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const hasChanges = (Object.keys(initial) as Array<keyof FormState>).some((key) => form[key] !== initial[key]);

    return (
        <form
            aria-label="Karbantartási mód beállításai"
            aria-busy={saving}
            onSubmit={async (event) => {
                event.preventDefault();
                if (saving || !hasChanges) return;
                setSaving(true);
                setError(null);
                try {
                    const result = await updateMaintenanceConfig({
                        active: form.active,
                        startsAt: fromLocalInputValue(form.startsAtLocal),
                        endsAt: fromLocalInputValue(form.endsAtLocal),
                        message: form.message,
                        adminBypass: form.adminBypass,
                    });
                    if (result.success) {
                        setForm(toFormState(result.config));
                        setSavedAt(Date.now());
                    } else {
                        setError(result.error);
                    }
                } catch {
                    setError("A mentés sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
                } finally {
                    setSaving(false);
                }
            }}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"
        >
            <fieldset disabled={saving} className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className={toggleCardClass(form.active)}>
                        <input
                            type="checkbox"
                            checked={form.active}
                            onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                            className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]"
                        />
                        <BoltIcon aria-hidden="true" className="h-4 w-4 text-amber-500" />
                        Karbantartás: {form.active ? "aktív" : "inaktív"}
                    </label>
                    <label className={toggleCardClass(form.adminBypass)}>
                        <input
                            type="checkbox"
                            checked={form.adminBypass}
                            onChange={(event) => setForm((current) => ({ ...current, adminBypass: event.target.checked }))}
                            className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]"
                        />
                        <ShieldCheckIcon aria-hidden="true" className="h-4 w-4 text-violet-500" />
                        Admin hozzáférés karbantartás alatt: {form.adminBypass ? "engedélyezve" : "tiltva"}
                    </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-medium text-gray-500">
                        Karbantartás kezdete
                        <input
                            type="datetime-local"
                            value={form.startsAtLocal}
                            onChange={(event) => setForm((current) => ({ ...current, startsAtLocal: event.target.value }))}
                            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60"
                        />
                    </label>
                    <label className="text-xs font-medium text-gray-500">
                        Karbantartás vége
                        <input
                            type="datetime-local"
                            value={form.endsAtLocal}
                            onChange={(event) => setForm((current) => ({ ...current, endsAtLocal: event.target.value }))}
                            className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60"
                        />
                    </label>
                    <p className="text-xs text-gray-400 sm:col-span-2">Mindkét időpont opcionális; ha üresen hagyja, az oldal nem jelenít meg dátumot a tájékoztatóban.</p>
                </div>

                <label className="block text-xs font-medium text-gray-500">
                    Tájékoztató üzenet
                    <textarea
                        required
                        rows={4}
                        maxLength={2000}
                        value={form.message}
                        onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
                        className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60"
                    />
                </label>
                <button
                    type="button"
                    disabled={saving || form.message === DEFAULT_MAINTENANCE_MESSAGE}
                    onClick={() => setForm((current) => ({ ...current, message: DEFAULT_MAINTENANCE_MESSAGE }))}
                    className="-mt-2 text-xs font-medium text-[rgb(49,171,2)] transition-colors hover:text-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:text-gray-300"
                >
                    Alapértelmezett szöveg visszaállítása
                </button>
            </fieldset>

            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
            {!error && savedAt && !hasChanges && <p role="status" className="mt-3 text-sm text-[rgb(49,171,2)]">Mentve.</p>}

            <div className="mt-3 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-3">
                <button
                    type="submit"
                    disabled={!hasChanges || saving}
                    className="rounded-lg bg-[rgb(49,171,2)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                    {saving ? "Mentés..." : "Beállítások mentése"}
                </button>
            </div>
        </form>
    );
}
