"use client";

import { useState } from "react";
import { updateAdminAccount } from "@/app/(protected)/admin/accounts/actions";
import { validateAccountProfile, type AccountProfileInput } from "@/lib/adminAccountEdit";
import type { AdminAccount } from "@/lib/adminAccountData";

const fields = [
    ["last_name", "Vezetéknév"], ["first_name", "Keresztnév"],
    ["phone", "Telefonszám"], ["county", "Vármegye"], ["city", "Település"],
] as const;

export default function AdminAccountEditor({ account, onCancel, onSaved }: {
    account: AdminAccount;
    onCancel: () => void;
    onSaved: (profile: AccountProfileInput) => void;
}) {
    const initial = Object.fromEntries(fields.map(([key]) => [key, account[key] ?? ""])) as AccountProfileInput;
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasChanges = fields.some(([key]) => form[key].trim() !== initial[key]);

    return <form aria-label="Személyes adatok módosítása" aria-busy={saving} onSubmit={async (event) => {
        event.preventDefault();
        if (saving || !hasChanges || !account.user_id) return;
        const validated = validateAccountProfile(form);
        if (validated.error) { setError(validated.error); return; }
        setSaving(true);
        setError(null);
        try {
            const result = await updateAdminAccount(account.user_id, validated.profile);
            if (result.success) onSaved(result.profile);
            else setError(result.error);
        } catch {
            setError("A mentés sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
        } finally {
            setSaving(false);
        }
    }}>
        <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([key, label]) => <label key={key} className="text-xs font-medium text-gray-500">{label}
                <input autoFocus={key === "last_name"} name={key} type={key === "phone" ? "tel" : "text"} required={key !== "city"} maxLength={100}
                    value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60" />
            </label>)}
        </fieldset>
        <p className="mt-2 text-xs text-gray-500">E-mail cím: {account.email || "Nincs megadva"} · Az e-mail címet a fiók tulajdonosa módosíthatja a személyes adatainál.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-3">
            <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50">Mégse</button>
            <button type="submit" disabled={!hasChanges || saving} className="rounded-lg bg-[rgb(49,171,2)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">{saving ? "Mentés..." : "Módosítás mentése"}</button>
        </div>
    </form>;
}
