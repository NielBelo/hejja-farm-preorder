"use client";

import { useEffect, useState } from "react";
import { FunnelIcon, XMarkIcon } from "@heroicons/react/24/outline";
import OrderFilterDropdown from "@/components/admin/OrderFilterDropdown";
import { emailTypeLabels, providerLabels, statusFilterLabels, type EmailLogPage, type EmailLogTone, type EmailProvider } from "@/lib/email/emailLogShared";

const dateFormatter = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Budapest" });
const toneClasses: Record<EmailLogTone, string> = {
    success: "bg-green-100 text-green-800",
    neutral: "bg-gray-100 text-gray-700",
    warning: "bg-amber-100 text-amber-800",
    error: "bg-red-100 text-red-800",
};
const providerClasses: Record<EmailProvider, string> = { smtp2go: "bg-blue-50 text-blue-700", resend: "bg-violet-50 text-violet-700" };
const statusOptions = Object.entries(statusFilterLabels).map(([value, label]) => ({ value, label }));
const typeOptions = Object.entries(emailTypeLabels).map(([value, label]) => ({ value, label }));
const providerOptions = Object.entries(providerLabels).map(([value, label]) => ({ value, label }));

export default function EmailLog() {
    // Szerkesztés alatt álló mezők – önmagukban sosem indítanak lekérdezést.
    const [draftSearch, setDraftSearch] = useState("");
    const [draftStatus, setDraftStatus] = useState("");
    const [draftProvider, setDraftProvider] = useState("");
    const [draftType, setDraftType] = useState("");
    // Ténylegesen alkalmazott szűrők – csak a Keresés / Szűrők törlése változtatja őket.
    const [applied, setApplied] = useState({ query: "", status: "", provider: "", type: "" });
    // tokens[i] az i. oldal lekérdezési tokenje (a 0. oldalé üres).
    const [tokens, setTokens] = useState<string[]>([""]);
    const [page, setPage] = useState(0);
    const [result, setResult] = useState<{ key: string; data: EmailLogPage | null; error: string | null } | null>(null);
    const [reloadCount, setReloadCount] = useState(0);

    const { query, status, provider, type } = applied;
    const token = tokens[page];
    const requestKey = JSON.stringify([query, status, provider, type, token, reloadCount]);
    const loading = result?.key !== requestKey;
    const data = result && !loading ? result.data : null;
    const error = result && !loading ? result.error : null;

    // Csak az alkalmazott szűrőktől, az oldaltól és a frissítésszámlálótól függ (a requestKey ezeket foglalja össze).
    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (status) params.set("status", status);
        if (provider) params.set("provider", provider);
        if (type) params.set("type", type);
        if (token) params.set("token", token);
        fetch(`/api/admin/email-server?${params}`, { signal: controller.signal })
            .then(async (response) => {
                const body = await response.json().catch(() => null);
                if (controller.signal.aborted) return;
                if (!response.ok) throw new Error(body?.error ?? "Az e-mail napló lekérdezése sikertelen.");
                setResult({ key: requestKey, data: body as EmailLogPage, error: null });
            })
            .catch((fetchError: unknown) => {
                if (controller.signal.aborted) return;
                setResult({ key: requestKey, data: null, error: fetchError instanceof Error ? fetchError.message : "Az e-mail napló lekérdezése sikertelen." });
            });
        return () => controller.abort();
    }, [query, status, provider, type, token, requestKey]);

    // Új szűrők alkalmazása: első oldal, és pontosan egy új lekérdezés (a kulcs mindig változik).
    function applyFilters(nextQuery: string, nextStatus: string, nextProvider: string, nextType: string) {
        setApplied({ query: nextQuery, status: nextStatus, provider: nextProvider, type: nextType });
        setTokens([""]);
        setPage(0);
        setReloadCount((count) => count + 1);
    }

    function search() {
        if (loading) return;
        const trimmed = draftSearch.trim();
        setDraftSearch(trimmed);
        applyFilters(trimmed, draftStatus, draftProvider, draftType);
    }

    function clearFilters() {
        setDraftSearch("");
        setDraftStatus("");
        setDraftProvider("");
        setDraftType("");
        applyFilters("", "", "", "");
    }

    function nextPage() {
        if (!data?.nextToken || loading) return;
        setTokens([...tokens.slice(0, page + 1), data.nextToken]);
        setPage(page + 1);
    }

    const hasFilters = Boolean(draftSearch || draftStatus || draftProvider || draftType || query || status || provider || type);
    const activeFilterCount = (query ? 1 : 0) + (status ? 1 : 0) + (provider ? 1 : 0) + (type ? 1 : 0);
    const filterSummary = [emailTypeLabels[type as keyof typeof emailTypeLabels], statusFilterLabels[status as keyof typeof statusFilterLabels], providerLabels[provider as EmailProvider]].filter(Boolean).join(" · ");

    return <div className="space-y-3">
        <section aria-label="E-mailek szűrése" className="relative mb-4 rounded-xl border border-zinc-200 bg-gradient-to-br from-zinc-100 to-zinc-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                    <FunnelIcon aria-hidden="true" className="h-5 w-5 text-zinc-500" />E-mailek szűrése
                    {activeFilterCount > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{activeFilterCount}</span>}
                </h2>
                <button type="button" disabled={!hasFilters} onClick={clearFilters}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />Szűrők törlése
                </button>
            </div>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); search(); }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                    <label className="block text-sm font-medium text-zinc-700">Címzett
                        <input type="search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Címzett e-mail-címe…"
                            className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm font-normal outline-blue-400" />
                    </label>
                    <OrderFilterDropdown label="E-mail típusa" options={typeOptions} selected={draftType ? [draftType] : []} disabled={false}
                        onChange={(values) => setDraftType(values.find((value) => value !== draftType) ?? "")} />
                    <OrderFilterDropdown label="Állapot" options={statusOptions} selected={draftStatus ? [draftStatus] : []} disabled={false}
                        onChange={(values) => setDraftStatus(values.find((value) => value !== draftStatus) ?? "")} />
                    <OrderFilterDropdown label="Szolgáltató" options={providerOptions} selected={draftProvider ? [draftProvider] : []} disabled={false}
                        onChange={(values) => setDraftProvider(values.find((value) => value !== draftProvider) ?? "")} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => !loading && setReloadCount((count) => count + 1)} disabled={loading}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Frissítés</button>
                    <button type="submit" disabled={loading} className="rounded-lg bg-[rgb(49,171,2)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">Keresés</button>
                </div>
            </form>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
                <p role="status" aria-live="polite">{loading ? "Betöltés…" : data ? <><span className="font-semibold text-zinc-700">{data.rows.length}</span> e-mail ezen az oldalon{filterSummary ? ` · ${filterSummary}` : ""}</> : " "}</p>
                <p>SMTP2GO: elmúlt 5 nap · Resend: elmúlt 30 nap. Levelenként a legfrissebb ismert állapot.</p>
            </div>
        </section>
        {!loading && data && data.warnings.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 [overflow-wrap:anywhere]">
            {data.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 [overflow-wrap:anywhere]">{error}</p>}
        {loading && !error && <p className="py-6 text-center text-sm text-gray-500">Betöltés…</p>}
        {!loading && !error && data && data.rows.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-sm text-gray-500">Nincs a feltételeknek megfelelő e-mail.</div>}

        {!loading && !error && data && data.rows.length > 0 && <>
            <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
                <table className="w-full min-w-[48rem] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                        <tr><th className="px-3 py-2">Dátum</th><th className="px-3 py-2">Címzett</th><th className="px-3 py-2">Tárgy</th><th className="px-3 py-2">Szolgáltató</th><th className="px-3 py-2">Állapot</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-gray-700">
                        {data.rows.map((row) => <tr key={row.id} className="align-top">
                            <td className="whitespace-nowrap px-3 py-2">{dateFormatter.format(new Date(row.date))}</td>
                            <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.recipient}</td>
                            <td className="px-3 py-2 [overflow-wrap:anywhere]">{row.subject}</td>
                            <td className="px-3 py-2">
                                <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${providerClasses[row.provider]}`}>{providerLabels[row.provider]}</span>
                            </td>
                            <td className="px-3 py-2">
                                <span title={`${providerLabels[row.provider]}: ${row.rawStatus || "ismeretlen"}`} className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[row.tone]}`}>{row.statusLabel}</span>
                                {row.tone !== "success" && row.rawStatus && <p className="mt-1 text-xs text-gray-400 [overflow-wrap:anywhere]">{row.rawStatus}</p>}
                                {row.detail && <p className="mt-1 max-w-xs text-xs text-gray-500 [overflow-wrap:anywhere]">{row.detail}</p>}
                            </td>
                        </tr>)}
                    </tbody>
                </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
                <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50 disabled:text-gray-300">Előző</button>
                <span>{page + 1}. oldal</span>
                <button type="button" onClick={nextPage} disabled={!data.nextToken}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50 disabled:text-gray-300">Következő</button>
            </div>
        </>}
    </div>;
}
