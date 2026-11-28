"use client";

import { useState } from "react";
import {
    ArchiveBoxIcon,
    ExclamationTriangleIcon,
    NoSymbolIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { deleteOwnAccount } from "@/app/(protected)/profile/actions";
import { ACCOUNT_DELETION_CONFIRMATION, isAccountDeletionConfirmed } from "@/lib/accountDeletion";

const INFO_ITEMS = [
    {
        icon: TrashIcon,
        tone: "bg-red-100 text-red-600",
        label: "Véglegesen törlődik",
        text: "A neved, e-mail-címed, telefonszámod, megyéd és településed, a belépési adataid és a hozzájárulásaid.",
    },
    {
        icon: ArchiveBoxIcon,
        tone: "bg-[#F0F5EB] text-[rgb(67,133,45)]",
        label: "Névtelenül megmarad",
        text: "A korábbi rendeléseid tartalma statisztikai célból. A rendelésekből nem derül ki, ki adta le őket.",
    },
    {
        icon: NoSymbolIcon,
        tone: "bg-amber-100 text-amber-700",
        label: "Mikor nem törölhető",
        text: "Amíg van aktív, még le nem zajlott átvételi napra szóló rendelésed. Előbb mondd le azt.",
    },
];

export default function DeleteAccountSection() {
    const [open, setOpen] = useState(false);
    const [confirmation, setConfirmation] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const close = () => {
        if (deleting) return;
        setOpen(false);
        setConfirmation("");
        setError(null);
    };

    const submit = async () => {
        setDeleting(true);
        setError(null);
        try {
            // Siker esetén a server action átirányít, ide csak hiba jut vissza.
            const result = await deleteOwnAccount(confirmation);
            if (result && !result.success) setError(result.error);
        } catch (caught) {
            // A Next átirányítása kivételként érkezik; azt tovább kell dobni.
            if (caught && typeof caught === "object" && "digest" in caught) throw caught;
            setError("A fiók törlése sikertelen. Kérjük, próbálja újra.");
        }
        setDeleting(false);
    };

    return (
        <section
            aria-labelledby="delete-account-title"
            className="mx-auto mt-8 w-full max-w-4xl rounded-2xl border border-red-200 bg-red-50/60 p-6 sm:p-8"
        >
            <div className="flex items-center gap-3">
                <ExclamationTriangleIcon className="h-7 w-7 shrink-0 text-red-600" aria-hidden="true" />
                <h2 id="delete-account-title" className="text-xl font-semibold text-gray-800">
                    Fiók törlése
                </h2>
            </div>
            <p className="mt-2 text-base leading-6 text-gray-600">
                A fiók törlése végleges, a művelet nem vonható vissza.
            </p>

            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
                {INFO_ITEMS.map(({ icon: Icon, tone, label, text }) => (
                    <li key={label} className="rounded-xl bg-white/80 p-4 ring-1 ring-black/5">
                        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
                            <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <p className="mt-3 text-base font-semibold text-gray-800">{label}</p>
                        <p className="mt-1 text-base leading-6 text-gray-600">{text}</p>
                    </li>
                ))}
            </ul>

            <div className="mt-6 flex justify-end">
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-red-700"
                >
                    <TrashIcon className="h-5 w-5" aria-hidden="true" />
                    Fiók törlése
                </button>
            </div>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
                    role="presentation"
                    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
                >
                    <div
                        className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-own-account-title"
                    >
                        <div className="flex items-center gap-3">
                            <ExclamationTriangleIcon className="h-8 w-8 shrink-0 text-red-600" aria-hidden="true" />
                            <h3 id="delete-own-account-title" className="text-2xl font-semibold text-gray-800">
                                Figyelem!
                            </h3>
                        </div>

                        <p className="mt-4 text-lg leading-7 text-gray-600">
                            Biztosan törölni szeretné a fiókját? A személyes adatai véglegesen
                            törlődnek, a művelet nem vonható vissza.
                        </p>

                        <label
                            htmlFor="delete-own-account-confirmation"
                            className="mt-6 mb-1.5 block text-base font-medium text-gray-400"
                        >
                            A megerősítéshez írja be:{" "}
                            <span className="font-semibold text-gray-800">{ACCOUNT_DELETION_CONFIRMATION}</span>
                        </label>
                        <input
                            id="delete-own-account-confirmation"
                            type="text"
                            value={confirmation}
                            onChange={(event) => setConfirmation(event.target.value)}
                            disabled={deleting}
                            autoComplete="off"
                            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-lg text-gray-800 outline-none transition placeholder:text-gray-300 focus:border-red-400 focus:ring-2 focus:ring-red-400/10 disabled:opacity-50"
                        />

                        {error && (
                            <div
                                role="alert"
                                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-600"
                            >
                                {error}
                            </div>
                        )}

                        <div className="mt-8 flex flex-wrap justify-end gap-3">
                            <button
                                type="button"
                                disabled={deleting}
                                onClick={close}
                                className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            >
                                Mégse
                            </button>
                            <button
                                type="button"
                                disabled={deleting || !isAccountDeletionConfirmed(confirmation)}
                                onClick={submit}
                                className="rounded-lg bg-red-600 px-5 py-3 text-base font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {deleting ? "Törlés..." : "Törlés"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
