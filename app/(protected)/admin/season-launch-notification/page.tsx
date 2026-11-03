import { buildSeasonLaunchEmail, type SeasonLaunchData } from "@/lib/email/seasonLaunch";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
    title: "Szezonindítási értesítő",
};

// Ha nincs elérhető szezon a season_parameters táblában, az előnézet
// egyértelműen jelölt mintaadatot használ.
const SAMPLE_SEASON: SeasonLaunchData = {
    year: 2027,
    season: "Tavasz",
    orderStart: "2027-01-15T08:00:00+01:00",
    orderEnd: "2027-02-15T20:00:00+01:00",
};

async function getPreviewSeason(): Promise<{ data: SeasonLaunchData; isSample: boolean }> {
    const supabase = await createClient();
    const { data: rows } = await supabase
        .from("season_parameters")
        .select("year, season, time_window_start, time_window_end, is_active")
        .not("time_window_start", "is", null)
        .not("time_window_end", "is", null)
        .order("time_window_start", { ascending: false });

    const seasons = rows ?? [];
    const now = Date.now();
    // A legközelebb induló (jövőbeli) szezon; ennek hiányában az aktív,
    // majd a legutóbbi szezon.
    const upcoming = seasons
        .filter((row) => new Date(row.time_window_start).getTime() > now)
        .sort((a, b) => new Date(a.time_window_start).getTime() - new Date(b.time_window_start).getTime())[0];
    const chosen = upcoming ?? seasons.find((row) => row.is_active) ?? seasons[0];

    if (!chosen) {
        return { data: SAMPLE_SEASON, isSample: true };
    }

    return {
        data: {
            year: chosen.year,
            season: chosen.season,
            orderStart: chosen.time_window_start,
            orderEnd: chosen.time_window_end,
        },
        isSample: false,
    };
}

export default async function AdminSeasonLaunchNotificationPage() {
    const { data, isSample } = await getPreviewSeason();
    const email = buildSeasonLaunchEmail(data, { logoSrc: "/images/logo2.png" });

    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="px-4 text-center sm:px-6">
                <div className="mt-2.5 flex items-center gap-4">
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                    <h1 className="shrink-0 text-md font-semibold tracking-wider text-gray-500">
                        Szezonindítási értesítő
                    </h1>
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                </div>
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    A szezonindítási értesítő az új előrendelési időszak kezdetéről tájékoztatja a vásárlókat.
                </p>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
                    <dl className="grid gap-3 text-sm">
                        <div className="grid grid-cols-[5rem_1fr] gap-3">
                            <dt className="font-medium text-gray-500">Tárgy</dt>
                            <dd className="font-medium text-gray-900">{email.subject}</dd>
                        </div>
                    </dl>
                </div>

                <div className="bg-[#f4f7f5] p-3 sm:p-6">
                    {isSample ? (
                        <p className="mb-3 text-center text-sm font-medium text-amber-700">
                            Mintaadat: nincs rögzített szezon, ezért az előnézet kitalált szezonadatokat mutat.
                        </p>
                    ) : null}
                    <iframe
                        title="Szezonindítási értesítő e-mail"
                        srcDoc={email.html}
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        className="w-full rounded-xl border-0 bg-[#f4f7f5]"
                        style={{ height: 760 }}
                    />
                </div>
            </div>
        </div>
    );
}
