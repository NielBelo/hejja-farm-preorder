"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { FilterOption } from "@/lib/adminOrderFilters";

export default function OrderFilterDropdown({ label, options, selected, disabled, onChange }: {
    label: string;
    options: FilterOption[];
    selected: string[];
    disabled: boolean;
    onChange: (values: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    const expanded = open && !disabled;

    useEffect(() => {
        if (!expanded) return;
        const closeOutside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => document.removeEventListener("pointerdown", closeOutside);
    }, [expanded]);

    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu");
    const visible = options.filter((option) => normalize(option.label).includes(normalize(search)));
    const summary = selected.length === 0 ? "Összes" : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label || "1 kiválasztva"
        : `${selected.length} kiválasztva`;

    return (
        <div ref={root} className="relative min-w-0" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }} onKeyDown={(event) => {
            if (event.key === "Escape" && expanded) {
                event.preventDefault();
                setOpen(false);
                trigger.current?.focus();
            }
        }}>
            <span id={`${id}-label`} className="mb-1.5 block text-sm font-medium text-zinc-700">{label}</span>
            <button ref={trigger} type="button" disabled={disabled} aria-expanded={expanded}
                aria-controls={`${id}-panel`} aria-labelledby={`${id}-label ${id}-value`}
                onClick={() => { setOpen(!open); setSearch(""); }}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium shadow-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50 ${selected.length ? "border-blue-400 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-600 hover:border-blue-400 hover:bg-zinc-50"}`}>
                <span
                    id={`${id}-value`}
                    className="min-w-0 flex-1 overflow-hidden whitespace-nowrap"
                    style={{
                        maskImage: "linear-gradient(to right, black calc(100% - 1.25rem), transparent)",
                        WebkitMaskImage: "linear-gradient(to right, black calc(100% - 1.25rem), transparent)",
                    }}
                >
                    {summary}
                </span>
                <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded && (
                <div id={`${id}-panel`} role="group" aria-labelledby={`${id}-label`}
                    className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-none">
                    <div className="border-b border-zinc-100 p-2">
                        <label className="flex items-center gap-2 rounded-md border border-transparent bg-zinc-50 px-2 py-2 focus-within:border-blue-400">
                            <MagnifyingGlassIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400" />
                            <input type="search" aria-label={`${label} keresése`} value={search} onChange={(event) => setSearch(event.target.value)}
                                placeholder="Keresés…" className="min-w-0 w-full bg-transparent text-sm text-zinc-700 outline-none placeholder:text-zinc-400" />
                        </label>
                    </div>
                    <div className="max-h-60 overflow-y-auto overscroll-contain p-1.5">
                        {visible.map((option) => (
                            <label key={option.value} className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-blue-50 ${selected.includes(option.value) ? "bg-blue-100 text-blue-700" : "text-zinc-700"}`}>
                                <input type="checkbox" checked={selected.includes(option.value)}
                                    onChange={() => onChange(selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value])}
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-blue-500" />
                                <span className="min-w-0 break-words">{option.label}</span>
                            </label>
                        ))}
                        {visible.length === 0 && <p className="px-2 py-3 text-sm text-zinc-500">Nincs találat.</p>}
                    </div>
                    <button type="button" disabled={selected.length === 0} onClick={() => onChange([])}
                        className="w-full border-t border-zinc-100 px-3 py-2 text-left text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:text-zinc-400">
                        Kijelölések törlése
                    </button>
                </div>
            )}
        </div>
    );
}
