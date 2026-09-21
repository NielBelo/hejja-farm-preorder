"use client";

import { useState } from "react";
import AdminAccountEditor from "@/components/admin/AdminAccountEditor";
import { deleteAdminAccount, deleteAdminInvite } from "@/app/(protected)/admin/accounts/actions";
import type { AdminAccountUpdateInput } from "@/lib/adminAccountEdit";
import { ArrowsPointingInIcon, ArrowsPointingOutIcon, CheckBadgeIcon, ChevronDownIcon, DocumentCheckIcon, EnvelopeIcon, FunnelIcon, MapIcon, MapPinIcon, PaperAirplaneIcon, PhoneIcon, ShieldCheckIcon, TruckIcon, UserCircleIcon, UserIcon, UserPlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import OrderFilterDropdown from "@/components/admin/OrderFilterDropdown";
import { accountName, accountStatusLabels, filterAccounts, specialNeedLabels, type AdminAccount } from "@/lib/adminAccountData";

const dateFormatter = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Budapest" });
function date(value: string | null) {
    return value ? dateFormatter.format(new Date(value)) : "Nincs rögzítve";
}
function roleLabel(role: string) {
    return role === "admin" ? "Adminisztrátor" : role === "user" ? "Vásárló" : role;
}
function accountBadge(account: AdminAccount) {
    if (account.status !== "registered") {
        return { label: accountStatusLabels[account.status], className: "bg-gray-100 text-gray-600" };
    }
    if (account.is_superadmin) return { label: "Szuper adminisztrátor", className: "bg-violet-50 text-violet-700" };
    if (account.role === "admin") return { label: "Adminisztrátor", className: "bg-violet-50 text-violet-700" };
    return { label: "Vásárló", className: "bg-blue-50 text-blue-700" };
}
function sizePreferenceBadge(preference: AdminAccount["special_size_preference"]) {
    if (preference === "larger") return { label: "Nagyobb méret", className: "bg-green-100 text-green-800" };
    if (preference === "smaller") return { label: "Kisebb méret", className: "bg-red-100 text-red-800" };
    return null;
}
function ProfileField({ label, value, icon: Icon }: {
    label: string;
    value: string | null;
    icon: typeof UserIcon;
}) {
    return <div className="flex min-w-0 items-start gap-2 py-2">
        <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
        <div className="min-w-0">
            <dt className="text-xs font-medium text-gray-500">{label}</dt>
            <dd className="text-sm font-medium text-gray-700 [overflow-wrap:anywhere]">
                {value?.trim() || <span className="font-normal text-gray-400">Nincs megadva</span>}
            </dd>
        </div>
    </div>;
}
function Privilege({ label, enabled, icon: Icon }: { label: string; enabled: boolean; icon: typeof TruckIcon }) {
    return <div className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm transition-all ${enabled ? "border-[rgb(49,171,2)] bg-[rgba(216,227,232,0.51)] text-gray-800 shadow-md" : "border-[rgba(7,109,143,0.2)] bg-white text-gray-500"}`}>
        <Icon aria-hidden="true" className={`h-4 w-4 ${enabled ? "text-[rgb(49,171,2)]" : "text-gray-400"}`} />
        <span>{label}</span><span className="ml-auto text-xs font-medium">{enabled ? "Aktív" : "Nincs"}</span>
    </div>;
}
function TimelineStep({ label, value, done, icon: Icon }: { label: string; value: string; done: boolean; icon: typeof PaperAirplaneIcon }) {
    return <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-[rgb(49,171,2)] text-white" : "bg-gray-200 text-gray-400"}`}>
            <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 pt-0.5">
            <dt className={`text-xs font-medium ${done ? "text-gray-600" : "text-gray-400"}`}>{label}</dt>
            <dd className={`break-words text-sm font-medium ${done ? "text-gray-800" : "text-gray-400"}`}>{value}</dd>
        </div>
    </div>;
}

export default function AdminAccountList({ accounts: initialAccounts }: { accounts: AdminAccount[] }) {
    const [savedAccounts, setSavedAccounts] = useState<Record<string, AdminAccountUpdateInput>>({});
    const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
    const accounts = initialAccounts.filter((account) => !deletedIds.has(account.id)).map((account) => ({ ...account, ...savedAccounts[account.id] }));
    const [editingId, setEditingId] = useState<string | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    const editing = editingId !== null;
    const [search, setSearch] = useState("");
    const [statuses, setStatuses] = useState<string[]>([]);
    const [roles, setRoles] = useState<string[]>([]);
    const [counties, setCounties] = useState<string[]>([]);
    const [specialNeeds, setSpecialNeeds] = useState<string[]>([]);
    const [openId, setOpenId] = useState<string | null>(null);
    const [confirmingAccount, setConfirmingAccount] = useState<AdminAccount | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const filtered = filterAccounts(accounts, search, statuses, roles, counties, specialNeeds);
    const selectionCount = statuses.length + roles.length + counties.length + specialNeeds.length + (search.trim() ? 1 : 0);
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
                <button type="button" disabled={!selectionCount || editing} onClick={() => { setSearch(""); setStatuses([]); setRoles([]); setCounties([]); setSpecialNeeds([]); setOpenId(null); }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />Szűrők törlése
                </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <label className="block text-sm font-medium text-zinc-700">Keresés
                    <input type="search" disabled={editing} value={search} onChange={(event) => { setSearch(event.target.value); setOpenId(null); }} placeholder="Név, e-mail, telefon, település…"
                        className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm font-normal outline-blue-400" />
                </label>
                <OrderFilterDropdown label="Állapot" options={Object.entries(accountStatusLabels).map(([value, label]) => ({ value, label }))} selected={statuses} disabled={editing} onChange={(values) => { setStatuses(values); setOpenId(null); }} />
                <OrderFilterDropdown label="Szerepkör" options={[...new Set(accounts.map((account) => account.role))].sort().map((value) => ({ value, label: roleLabel(value) }))} selected={roles} disabled={editing} onChange={(values) => { setRoles(values); setOpenId(null); }} />
                <OrderFilterDropdown label="Vármegye" options={countyOptions} selected={counties} disabled={editing} onChange={(values) => { setCounties(values); setOpenId(null); }} />
                <OrderFilterDropdown label="Speciális igény" options={Object.entries(specialNeedLabels).map(([value, label]) => ({ value, label }))} selected={specialNeeds} disabled={editing} onChange={(values) => { setSpecialNeeds(values); setOpenId(null); }} />
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
            const badge = accountBadge(account);
            const sizeBadge = sizePreferenceBadge(account.special_size_preference);
            return <article key={account.id} className={`overflow-hidden rounded-xl bg-white shadow-sm transition-all ${open ? "border-2 border-blue-400 ring-2 ring-blue-100" : "border border-gray-200"}`}>
                <h2><button type="button" disabled={editing} aria-expanded={open} aria-controls={panelId} onClick={() => setOpenId(open ? null : account.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/70 focus-visible:outline-blue-400">
                    <UserCircleIcon aria-hidden="true" className="h-8 w-8 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                            <span className="break-words font-semibold text-gray-800">{accountName(account)}</span>
                            <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${badge.className}`}>{badge.label}</span>
                            {sizeBadge && <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${sizeBadge.className}`}>{sizeBadge.label}</span>}
                            {account.oroshazi_delivery && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                <TruckIcon aria-hidden="true" className="h-3.5 w-3.5" />Orosházi kiszállítás
                            </span>}
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
                                onSaved={(updatedAccount) => {
                                    setSavedAccounts((current) => ({ ...current, [account.id]: updatedAccount }));
                                    setEditingId(null);
                                    setSavedId(account.id);
                                }} /> : <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                                <ProfileField label="Név" value={[account.last_name, account.first_name].filter(Boolean).join(" ")} icon={UserIcon} />
                                <ProfileField label="E-mail cím" value={account.email} icon={EnvelopeIcon} />
                                <ProfileField label="Telefonszám" value={account.phone?.replace(/^(\+36)(\d{2})(\d{3})(\d{4})$/, "$1 $2 $3 $4") ?? null} icon={PhoneIcon} />
                                <ProfileField label="Vármegye" value={account.county} icon={MapIcon} />
                                <ProfileField label="Település" value={account.city} icon={MapPinIcon} />
                            </dl>}
                        </section>
                        {editingId !== account.id && <section className="border-t border-gray-100 pt-3">
                            <h3 className="mb-1 text-sm font-semibold text-gray-700">Adminisztrátori privilégiumok</h3>
                            <p className="mb-3 text-xs text-gray-500">Csak az adminisztráció számára megjelenő beállítások.</p>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                <Privilege label="Adminisztrátori jog" enabled={account.role === "admin"} icon={ShieldCheckIcon} />
                                <Privilege label="Kisebb méret preferáció" enabled={account.special_size_preference === "smaller"} icon={ArrowsPointingInIcon} />
                                <Privilege label="Nagyobb méret preferáció" enabled={account.special_size_preference === "larger"} icon={ArrowsPointingOutIcon} />
                                <Privilege label="Orosházi kiszállítás" enabled={account.oroshazi_delivery} icon={TruckIcon} />
                            </div>
                        </section>}
                        <section className="border-t border-gray-100 pt-3">
                            <h3 className="mb-3 text-sm font-semibold text-gray-700">Regisztráció és adatkezelés</h3>
                            <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3.5">
                                <p className="mb-3 text-xs font-medium text-gray-400">Regisztrációs folyamat</p>
                                <dl className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-0">
                                    {[
                                        { label: sentDates.length > 1 ? "Regisztrációs token legutóbbi kiküldése" : "Regisztrációs token kiküldése", value: date(sentDates[0] ?? null), done: Boolean(sentDates[0]), icon: PaperAirplaneIcon },
                                        { label: "Regisztráció", value: account.user_id ? date(account.registered_at) : "Még nem regisztrált", done: Boolean(account.user_id), icon: UserPlusIcon },
                                        { label: "E-mail megerősítése", value: date(account.email_confirmed_at), done: Boolean(account.email_confirmed_at), icon: CheckBadgeIcon },
                                    ].flatMap((step, index, steps) => [
                                        <TimelineStep key={`step-${index}`} {...step} />,
                                        index < steps.length - 1 ? <div key={`divider-${index}`} aria-hidden="true" className="hidden h-px flex-1 self-start bg-gray-200 sm:mt-3.5 sm:block" /> : null,
                                    ])}
                                </dl>
                            </div>
                            <dl className="mt-3 rounded-lg border border-gray-100 px-3.5 py-3">
                                <div className="flex items-start gap-2.5">
                                    <DocumentCheckIcon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${privacyVersions.length ? "text-[rgb(49,171,2)]" : "text-gray-300"}`} />
                                    <div className="min-w-0">
                                        <dt className="text-xs font-medium text-gray-500">Adatkezelési tájékoztató</dt>
                                        <dd className="break-words text-sm font-medium text-gray-800">{privacyVersions.length ? `Elfogadta · ${privacyVersions.join(", ")}` : "Nincs rögzített elfogadás"}</dd>
                                    </div>
                                </div>
                            </dl>
                        </section>
                        {savedId === account.id && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">A személyes adatok módosítása sikeres.</p>}
                        {editingId !== account.id && <div className="border-t border-gray-200 pt-3">
                            {account.user_id && <button type="button" disabled={editing || deleting} onClick={() => { setEditingId(account.id); setSavedId(null); }}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300">Módosítás</button>
                            }
                            {!account.is_superadmin && <button type="button" disabled={editing || deleting} onClick={() => { setDeleteError(null); setConfirmingAccount(account); }}
                                className="ml-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300">{account.user_id ? "Fiók törlése" : "Meghívó törlése"}</button>}
                        </div>}
                    </>}
                </div>
            </article>;
        })}
        {confirmingAccount && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmingAccount(null); }}>
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
                <h2 id="delete-account-title" className="text-lg font-semibold text-gray-900">{confirmingAccount.user_id ? "Fiók törlésének megerősítése" : "Meghívó törlésének megerősítése"}</h2>
                <p className="mt-3 text-sm leading-6 text-gray-700">{confirmingAccount.user_id ? "A fiókhoz tartozó személyes adatok, rendelések, hozzájárulások és meghívók is végleg törlődnek." : "A fel nem használt meghívó végleg törlődik."}</p>
                <p className="mt-2 break-words text-sm font-semibold text-gray-900">{accountName(confirmingAccount)} · {confirmingAccount.email}</p>
                {deleteError && <p role="alert" className="mt-3 text-sm text-red-700">{deleteError}</p>}
                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" disabled={deleting} onClick={() => setConfirmingAccount(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">Mégse</button>
                    <button type="button" disabled={deleting} onClick={async () => {
                        setDeleting(true); setDeleteError(null);
                        const result = confirmingAccount.user_id ? await deleteAdminAccount(confirmingAccount.user_id) : await deleteAdminInvite(confirmingAccount.email ?? "");
                        if (result.success) { setDeletedIds((current) => new Set(current).add(confirmingAccount.id)); setOpenId(null); setConfirmingAccount(null); }
                        else setDeleteError(result.error);
                        setDeleting(false);
                    }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{deleting ? "Törlés…" : "Igen, törlöm"}</button>
                </div>
            </div>
        </div>}
    </div>;
}
