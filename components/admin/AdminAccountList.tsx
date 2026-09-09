"use client";

import { useState } from "react";
import AdminAccountEditor from "@/components/admin/AdminAccountEditor";
import type { AccountProfileInput } from "@/lib/adminAccountEdit";
import { ChevronDownIcon, FunnelIcon, UserCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import OrderFilterDropdown from "@/components/admin/OrderFilterDropdown";
import { accountName, accountStatusLabels, filterAccounts, type AdminAccount } from "@/lib/adminAccountData";

const dateFormatter = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Budapest" });
function date(value: string | null) {
    return value ? dateFormatter.format(new Date(value)) : "Nincs rögzítve";
}
function roleLabel(role: string) {
    return role === "admin" ? "Adminisztrátor" : role === "user" ? "Vásárló" : role;
}
function Field({ label, value }: { label: string; value: string | null }) {
    return <div className="min-w-0"><dt className="text-xs text-gray-500">{label}</dt><dd className="break-words text-sm font-medium text-gray-800">{value || "Nincs megadva"}</dd></div>;
}

export default function AdminAccountList({ accounts: initialAccounts }: { accounts: AdminAccount[] }) {
    const [savedProfiles, setSavedProfiles] = useState<Record<string, AccountProfileInput>>({});
    const accounts = initialAccounts.map((account) => ({ ...account, ...savedProfiles[account.id] }));
    const [editingId, setEditingId] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    const editing = editingId !== null;
    const [search, setSearch] = useState("");
    const [statuses, setStatuses] = useState<string[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [counties, setCounties] = useState<string[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const filtered = filterAccounts(accounts, search, statuses, roles, counties);
    const selectionCount = statuses.length + roles.length + counties.length + (search.trim() ? 1 : 0);
    const countyOptions = [...new Set(accounts.map((account) => account.county || "__missing"))]
        .sort((a, b) => a.localeCompare(b, "hu"))
        .map((value) => ({ value, label: value === "__missing" ? "Nincs megadva" : value }));

    return <div className="space-y-3">
        <section aria-label="Felhasználók szűrése" className="relative mb-5 rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-100 to-zinc-50 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                    <FunnelIcon aria-hidden="true" className="h-5 w-5 text-zinc-500" />Felhasználók szűrése
                    {selectionCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{selectionCount}</span>}
                </h2>
                <button type="button" disabled={!selectionCount || editing} onClick={() => { setSearch(""); setStatuses([]); setRoles([]); setCounties([]); setOpenId(null); }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />Szűrők törlése
                </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm font-medium text-zinc-700">Keresés
                    <input type="search" disabled={editing} value={search} onChange={(event) => { setSearch(event.target.value); setOpenId(null); }} placeholder="Név, e-mail, telefon, település…"
                        className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm font-normal outline-blue-400" />
                </label>
                <OrderFilterDropdown label="Állapot" options={Object.entries(accountStatusLabels).map(([value, label]) => ({ value, label }))} selected={statuses} disabled={editing} onChange={(values) => { setStatuses(values); setOpenId(null); }} />
                <OrderFilterDropdown label="Szerepkör" options={[...new Set(accounts.map((account) => account.role))].sort().map((value) => ({ value, label: roleLabel(value) }))} selected={roles} disabled={editing} onChange={(values) => { setRoles(values); setOpenId(null); }} />
                <OrderFilterDropdown label="Vármegye" options={countyOptions} selected={counties} disabled={editing} onChange={(values) => { setCounties(values); setOpenId(null); }} />
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
                <p role="status" aria-live="polite"><span className="font-semibold text-zinc-700">{filtered.length}</span> / {accounts.length} fiók és meghívott</p>
                <p>{editing ? "A szűréshez előbb mentse vagy zárja be a módosítást." : "Egy szűrőben több lehetőség is kiválasztható."}</p>
            </div>
        </section>
        {!filtered.length && <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-500">
            {accounts.length ? "Nincs a kiválasztott szűrőknek megfelelő felhasználó." : "Még nincs megjeleníthető felhasználó vagy meghívott."}
        </div>}
        {filtered.map((account) => {
            const sentDates = account.invites
                .map((invite) => invite.sent_at)
                .filter((value): value is string => Boolean(value))
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
            const privacyVersions = [...new Set(account.consents
                .filter((consent) => consent.document_type === "privacy_policy")
                .map((consent) => consent.document_version))];
            const open = openId === account.id;
            const panelId = `account-${encodeURIComponent(account.id)}`;
            return <article key={account.id} className={`overflow-hidden rounded-xl bg-white shadow-sm transition-all ${open ? "border-2 border-blue-400 ring-2 ring-blue-100" : "border border-gray-200"}`}>
                <h2><button type="button" disabled={editing} aria-expanded={open} aria-controls={panelId} onClick={() => setOpenId(open ? null : account.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/70 focus-visible:outline-blue-400">
                    <UserCircleIcon aria-hidden="true" className="h-8 w-8 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="break-words font-semibold text-gray-800">{accountName(account)}</span>
                            <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${account.status === "registered" ? "bg-green-50 text-green-700" : account.status === "invited" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{accountStatusLabels[account.status]}</span>
                            {account.role === "admin" && <span className="rounded-md bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">Adminisztrátor</span>}
                        </span>
                        <span className="mt-1.5 block break-words text-sm text-gray-500">{[account.email, account.county, account.city].filter(Boolean).join(" · ")}</span>
                    </span>
                    <ChevronDownIcon aria-hidden="true" className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </button></h2>
                <div id={panelId} hidden={!open} className="space-y-3 border-t border-gray-100 px-4 py-3">
                    {open && <>
                        <section>
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">Személyes és kapcsolattartási adatok</h3>
                            {editingId === account.id ? <AdminAccountEditor account={account}
                                onCancel={() => setEditingId(null)}
                                onSaved={(profile) => {
                                    setSavedProfiles((current) => ({ ...current, [account.id]: profile }));
                                    setEditingId(null);
                                    setSavedId(account.id);
                                }} /> : <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                                <Field label="Név" value={[account.last_name, account.first_name].filter(Boolean).join(" ")} />
                                <Field label="E-mail cím" value={account.email} /><Field label="Telefonszám" value={account.phone} />
                                <Field label="Vármegye" value={account.county} /><Field label="Település" value={account.city} />
                                <Field label="Szerepkör" value={account.user_id ? roleLabel(account.role) : "Még nincs felhasználói fiók"} />
                            </dl>}
                        </section>
                        <section className="border-t border-gray-100 pt-3">
                            <h3 className="mb-2 text-sm font-semibold text-gray-700">Regisztráció és adatkezelés</h3>
                            <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                                <Field label={sentDates.length > 1 ? "Regisztrációs token legutóbbi kiküldése" : "Regisztrációs token kiküldése"} value={date(sentDates[0] ?? null)} />
                                <Field label="Regisztráció" value={account.user_id ? date(account.registered_at) : "Még nem regisztrált"} />
                                <Field label="E-mail megerősítése" value={date(account.email_confirmed_at)} />
                                <Field label="Adatkezelési tájékoztató" value={privacyVersions.length ? `Elfogadta · ${privacyVersions.join(", ")}` : "Nincs rögzített elfogadás"} />
                            </dl>
                        </section>
                        {savedId === account.id && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">A személyes adatok módosítása sikeres.</p>}
                        {editingId !== account.id && account.user_id && <div className="border-t border-gray-200 pt-3">
                            <button type="button" disabled={editing} onClick={() => { setEditingId(account.id); setSavedId(null); }}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300">Módosítás</button>
                        </div>}
                    </>}
                </div>
            </article>;
        })}
    </div>;
}
