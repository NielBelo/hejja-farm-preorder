"use client";

import { useState } from "react";
import { EnvelopeIcon } from "@heroicons/react/24/outline";
import { updateReminderSwitch, updateSeasonLaunchSwitch } from "@/app/(protected)/admin/accounts/maintenance/actions";
import type { SendingSwitch } from "@/lib/email/sendingSwitch";

type SwitchKind = "seasonLaunch" | "reminder";

const CARDS: Record<SwitchKind, { title: string; description: string; update: typeof updateSeasonLaunchSwitch }> = {
    seasonLaunch: {
        title: "Szezonindítási értesítő küldése",
        description:
            "Bekapcsolt állapotban a rendszer a szezon előrendelési időszakának kezdőnapján, 08:00-kor (budapesti idő) automatikusan "
            + "elküldi az értesítőt minden regisztrált vásárlónak. Kikapcsolt állapotban semmilyen levél nem megy ki. Ha a kezdőnapi "
            + "futás kimarad (például a kapcsoló csak 08:00 után lett bekapcsolva), utólag nem küld levelet.",
        update: updateSeasonLaunchSwitch,
    },
    reminder: {
        title: "Átvételi értesítő (emlékeztető) küldése",
        description:
            "Bekapcsolt állapotban a rendszer minden nap 08:00-kor (budapesti idő) elküldi az emlékeztetőt a másnapi átvételre "
            + "rendelt vásárlóknak, és a futásról összesítőt küld az adminoknak. Kikapcsolt állapotban semmilyen levél nem megy ki. "
            + "Amit egy napon nem küld ki a rendszer, azt utólag, magától nem pótolja.",
        update: updateReminderSwitch,
    },
};

function formatUpdatedAt(iso: string | null) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("hu-HU", { timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short" });
}

// inheritedFromEnv: a kapcsolót még nem módosították ezen az oldalon, az
// állapot a korábbi (környezeti változós) beállításból származik.
export default function SendingSwitchCard({
    kind,
    initialState,
    inheritedFromEnv = false,
}: {
    kind: SwitchKind;
    initialState: SendingSwitch;
    inheritedFromEnv?: boolean;
}) {
    const card = CARDS[kind];
    const [state, setState] = useState(initialState);
    const [inherited, setInherited] = useState(inheritedFromEnv);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const updatedAt = formatUpdatedAt(state.updatedAt);

    async function toggle() {
        if (saving) return;
        setSaving(true);
        setError(null);
        try {
            const result = await card.update(!state.enabled);
            if (result.success) {
                setState(result.state);
                setInherited(false);
            } else {
                setError(result.error);
            }
        } catch {
            setError("A mentés sikertelen. Ellenőrizze a kapcsolatot, majd próbálja újra.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <section aria-label={card.title} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <EnvelopeIcon aria-hidden="true" className="h-5 w-5 text-[#8A7355]" />
                    <h2 className="text-base font-semibold text-gray-800">{card.title}</h2>
                </div>
                <span
                    role="status"
                    className={`rounded-full px-3 py-1 text-sm font-medium ${state.enabled ? "bg-[#E0EED4] text-[rgb(42,110,20)]" : "bg-gray-100 text-gray-600"}`}
                >
                    {state.enabled ? "Bekapcsolva" : "Kikapcsolva"}
                </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-gray-600">{card.description}</p>

            {inherited ? (
                <p className="mt-2 text-xs text-gray-400">
                    Ezt a kapcsolót még nem módosították ezen az oldalon, az állapot a korábbi beállításból származik.
                </p>
            ) : updatedAt ? (
                <p className="mt-2 text-xs text-gray-400">
                    Utoljára módosítva: {updatedAt}{state.updatedBy ? ` (${state.updatedBy})` : ""}
                </p>
            ) : null}

            {error && <p role="alert" className="mt-3 text-sm text-[#C83D3D]">{error}</p>}

            <div className="mt-3 flex justify-end border-t border-gray-200 pt-3">
                <button
                    type="button"
                    onClick={toggle}
                    disabled={saving}
                    className={`rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 ${state.enabled ? "bg-[#C83D3D] hover:bg-[#A83030]" : "bg-[rgb(67,133,45)] hover:bg-[rgb(42,150,2)]"}`}
                >
                    {saving ? "Mentés..." : state.enabled ? "Küldés kikapcsolása" : "Küldés bekapcsolása"}
                </button>
            </div>
        </section>
    );
}
