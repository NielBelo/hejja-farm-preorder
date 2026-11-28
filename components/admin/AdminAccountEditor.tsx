"use client";

import { CheckIcon, ChevronDownIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { updateAdminAccount } from "@/app/(protected)/admin/accounts/actions";
import { validateAdminAccount, type AdminAccountUpdateInput } from "@/lib/adminAccountEdit";
import type { AdminAccount } from "@/lib/adminAccountData";
import { formatHungarianPhoneInput as formatPhoneInput } from "@/lib/phoneNumber";

const counties = [
    "Bács-Kiskun", "Baranya", "Békés", "Borsod-Abaúj-Zemplén", "Budapest", "Csongrád-Csanád", "Fejér",
    "Győr-Moson-Sopron", "Hajdú-Bihar", "Heves", "Jász-Nagykun-Szolnok", "Komárom-Esztergom", "Nógrád",
    "Pest", "Somogy", "Szabolcs-Szatmár-Bereg", "Tolna", "Vas", "Veszprém", "Zala",
];

function privilegeCardClass(checked: boolean) {
    return `flex cursor-pointer items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-all ${checked ? "border-[rgb(67,133,45)] bg-[#E0EED4] text-gray-800 shadow-md" : "border-[#D4CCBE] bg-white text-gray-700 hover:border-[rgb(67,133,45)] hover:bg-gray-50"}`;
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
        <label className="text-xs font-medium text-gray-500">Megye</label>
        <button type="button" disabled={disabled} onClick={() => setIsOpen((open) => !open)} aria-haspopup="listbox" aria-expanded={isOpen}
            className={`mt-1 flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm text-gray-800 outline-none transition disabled:opacity-60 ${isOpen ? "border-[rgb(67,133,45)] ring-2 ring-[rgb(67,133,45)]/10" : "border-gray-300"}`}>
            <span className={value ? "text-gray-800" : "text-gray-400"}>{value || "Válasszon megyét"}</span>
            <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
        {isOpen && <div className="absolute left-0 right-0 z-40 mt-1.5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <div role="listbox" className="max-h-64 overflow-y-auto p-1.5">
                {counties.map((county) => {
                    const selected = county === value;
                    return <button key={county} type="button" role="option" aria-selected={selected} onClick={() => { onChange(county); setIsOpen(false); }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-[#F0F5EB] ${selected ? "bg-[#F0F5EB] font-medium" : "bg-white"}`}>
                        <span>{county}</span>{selected && <CheckIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-[rgb(67,133,45)]" />}
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
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#43852D] focus:outline-[#43852D] disabled:opacity-60" />
            </label>
            <label className="text-xs font-medium text-gray-500">Keresztnév
                <input name="first_name" type="text" required maxLength={100} value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#43852D] focus:outline-[#43852D] disabled:opacity-60" />
            </label>
            <label className="text-xs font-medium text-gray-500">Telefonszám
                <input name="phone" type="tel" inputMode="tel" required maxLength={16} placeholder="+36 30 123 4567" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#43852D] focus:outline-[#43852D] disabled:opacity-60" />
            </label>
            <CountySelect value={form.county} disabled={saving} onChange={(county) => setForm((current) => ({ ...current, county }))} />
            <label className="text-xs font-medium text-gray-500">Település
                <input name="city" type="text" required maxLength={100} value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-[#43852D] focus:outline-[#43852D] disabled:opacity-60" />
            </label>
            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:col-span-2 lg:col-span-3" aria-label="Adminisztrátori privilégiumok">
                <div><p className="text-sm font-semibold text-slate-800">Adminisztrátori privilégiumok</p><p className="mt-0.5 text-xs text-slate-500">Ezek a beállítások kizárólag itt, az admin felületen láthatók.</p></div>
                {account.is_superadmin ? (
                    <p className="flex items-center gap-2 text-sm text-[#604D35]"><ShieldCheckIcon aria-hidden="true" className="h-5 w-5" />Superadmin · A védett jogosultság nem módosítható.</p>
                ) : (
                    <label className={`${privilegeCardClass(form.role === "admin")} font-medium`}>
                        <input type="checkbox" checked={form.role === "admin"} onChange={(event) => setForm((current) => ({ ...current, role: event.target.checked ? "admin" : "user" }))}
                            className="h-4 w-4 rounded border-gray-300 text-[rgb(67,133,45)] focus:ring-[rgb(67,133,45)]" />
                        <ShieldCheckIcon aria-hidden="true" className="h-4 w-4 text-[#8A7355]" />Adminisztrátori jog
                    </label>
                )}
            </section>
        </fieldset>
        <p className="mt-2 text-xs text-gray-500">E-mail cím: {account.email || "Nincs megadva"} · Az e-mail címet a fiók tulajdonosa módosíthatja a személyes adatainál.</p>
        {error && <p role="alert" className="mt-3 text-sm text-[#C83D3D]">{error}</p>}
        <div className="mt-3 flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-3">
            <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50">Mégse</button>
            <button type="submit" disabled={!hasChanges || saving} className="rounded-lg bg-[rgb(67,133,45)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(42,150,2)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">{saving ? "Mentés..." : "Módosítás mentése"}</button>
        </div>
    </form>;
}
