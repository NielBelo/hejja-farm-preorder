"use client";

import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { updateAdminAccount } from "@/app/(protected)/admin/accounts/actions";
import { validateAdminAccount, type AdminAccountUpdateInput } from "@/lib/adminAccountEdit";
import type { AdminAccount } from "@/lib/adminAccountData";

const counties = [
    "Bács-Kiskun", "Baranya", "Békés", "Borsod-Abaúj-Zemplén", "Budapest", "Csongrád-Csanád", "Fejér",
    "Győr-Moson-Sopron", "Hajdú-Bihar", "Heves", "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád",
    "Pest", "Somogy", "Szabolcs-Szatmár-Bereg", "Tolna", "Vas", "Veszprém", "Zala",
];

function formatPhoneInput(value: string): string {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("06")) digits = `36${digits.slice(2)}`;
    if (!digits.startsWith("36")) digits = `36${digits}`;
    digits = digits.slice(0, 11);

    const prefix = digits.slice(2, 4);
    const first = digits.slice(4, 7);
    const second = digits.slice(7, 11);
    return `+36${prefix ? ` ${prefix}` : ""}${first ? ` ${first}` : ""}${second ? ` ${second}` : ""}`;
}

function CountySelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    return <div ref={containerRef} className="relative">
        <label className="text-xs font-medium text-gray-500">Vármegye</label>
        <button type="button" disabled={disabled} onClick={() => setIsOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={isOpen}
            className={`mt-1 flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm text-gray-800 outline-none transition disabled:opacity-60 ${isOpen ? "border-[rgb(49,171,2)] ring-2 ring-[rgb(49,171,2)]/10" : "border-gray-300"}`}>
            <span className={value ? "text-gray-800" : "text-gray-400"}>{value || "Válasszon vármegyét"}</span>
            <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen && <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <div role="listbox" className="max-h-64 overflow-y-auto p-1.5">
                {counties.map((county) => {
                    const selected = county === value;
                    return <button key={county} type="button" role="option" aria-selected={selected} onClick={() => { onChange(county); setIsOpen(false); }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-[#F0FAEE] ${selected ? "bg-[#F0FAEE] font-medium" : "bg-white"}`}>
                        <span>{county}</span>{selected && <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(49,171,2)]" />}
                    </button>;
                })}
            </div>
        </div>}
    </div>;
}

export default function AdminAccountEditor({ account, onCancel, onSaved }: {
    account: AdminAccount;
    onCancel: () => void;
    onSaved: (account: AdminAccountUpdateInput) => void;
}) {
    const initial: AdminAccountUpdateInput = {
        last_name: account.last_name ?? "",
        first_name: account.first_name ?? "",
        phone: formatPhoneInput(account.phone ?? ""),
        county: account.county ?? "",
        city: account.city ?? "",
        role: account.role === "admin" ? "admin" : "user",
        special_size_preference: account.special_size_preference,
    };
    const [form, setForm] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const hasChanges = (Object.keys(initial) as Array<keyof AdminAccountUpdateInput>)
        .some((key) => form[key] !== initial[key]);

    return <form aria-label="Személyes adatok módosítása" aria-busy={saving} onSubmit={async (event) => {
        event.preventDefault();
        if (saving || !hasChanges || !account.user_id) return;
        const validated = validateAdminAccount(form);
        if (validated.error) { setError(validated.error); return; }
        setSaving(true);
        setError(null);
        try {
            const result = await updateAdminAccount(account.user_id, validated.account);
            if (result.success) onSaved(result.account);
            else setError(result.error);
        } catch {
            setError("A mentés sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
        } finally {
            setSaving(false);
        }
    }}>
        <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-gray-500">Vezetéknév
                <input autoFocus name="last_name" type="text" required maxLength={100} value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60" />
            </label>
            <label className="text-xs font-medium text-gray-500">Keresztnév
                <input name="first_name" type="text" required maxLength={100} value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60" />
            </label>
            <label className="text-xs font-medium text-gray-500">Telefonszám
                <input name="phone" type="tel" inputMode="tel" required maxLength={16} placeholder="+36 30 123 4567" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60" />
            </label>
            <CountySelect value={form.county} disabled={saving} onChange={(county) => setForm((current) => ({ ...current, county }))} />
            <label className="text-xs font-medium text-gray-500">Település
                <input name="city" type="text" required maxLength={100} value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-400 focus:outline-blue-400 disabled:opacity-60" />
            </label>
            <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:col-span-2 lg:col-span-3">
                <p className="text-sm font-semibold text-gray-700">Jogosultság és speciális igények</p>
                {account.is_superadmin ? (
                    <p className="text-sm text-violet-700">Superadmin · A védett jogosultság nem módosítható.</p>
                ) : (
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                        <input type="checkbox" checked={form.role === "admin"} onChange={(event) => setForm((current) => ({ ...current, role: event.target.checked ? "admin" : "user" }))}
                            className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]" />
                        Adminisztrátor
                    </label>
                )}
                <div>
                    <p className="mb-2 text-sm font-medium text-gray-500">Speciális méretigény</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" checked={form.special_size_preference === "smaller"} onChange={(event) => setForm((current) => ({ ...current, special_size_preference: event.target.checked ? "smaller" : null }))}
                                className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]" />
                            Átlagostól kisebb méret, ha lehet
                        </label>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" checked={form.special_size_preference === "larger"} onChange={(event) => setForm((current) => ({ ...current, special_size_preference: event.target.checked ? "larger" : null }))}
                                className="h-4 w-4 rounded border-gray-300 text-[rgb(49,171,2)] focus:ring-[rgb(49,171,2)]" />
                            Átlagostól nagyobb méret, ha lehet
                        </label>
                    </div>
                </div>
            </div>
        </fieldset>
        <p className="mt-2 text-xs text-gray-500">E-mail cím: {account.email || "Nincs megadva"} · Az e-mail címet a fiók tulajdonosa módosíthatja a személyes adatainál.</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-3">
            <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50">Mégse</button>
            <button type="submit" disabled={!hasChanges || saving} className="rounded-lg bg-[rgb(49,171,2)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">{saving ? "Mentés..." : "Módosítás mentése"}</button>
        </div>
    </form>;
}
