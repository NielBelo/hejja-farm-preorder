import OrderConfirmationSummary from "@/components/OrderConfirmationSummary";
import { createClient } from "@/lib/supabase/server";
import { getActiveSeasonPickupTimes } from "@/lib/activeSeasonPickupTimes";

// Ugyanaz a komponens jelenik meg itt, mint amit a vásárló az Előrendelés
// oldalon lát a rendelés sikeres leadása után - a rendelésre és a tételekre
// vonatkozó adatok csak a fejlesztői előnézethez kellenek, valódi rendelés
// nem jön létre. Az átvételi időpontok viszont NEM ezek közül a minta-
// mezők közül származnak, hanem a jelenleg aktív szezon valós
// season_parameters beállításaiból (lásd lent), hogy az előnézet mindig a
// Szezonok oldalon tényleg beállított időpontokat mutassa. Mindkét
// megye-ág (tanyasi/Békés és városi/más megye) egyszerre látható, ugyanazzal
// a komponenssel és megye-alapú döntési logikával (lib/pickupInfo), mint az
// éles előrendelési folyamatban.
const sampleOrderConfirmation = {
    orderNumber: "HF-777153",
    pickupDate: "2026-10-07",
    submittedAt: new Date("2026-09-16T23:42:00+02:00"),
    seasonEndDate: "2026-09-29T23:59:00+02:00",
    emailRecipient: "hejjafarm.admin@gmail.com",
    items: [
        {
            productName: "Darabolt csirke",
            packageName: "Egyedi csomagolás",
            quantity: 3,
            sizePreference: "Átlagostól kisebb méret",
            note: null,
        },
    ],
};

// A három megyeág mintaadata - a helyszín/időpont, illetve a Bács-Kiskun
// esetén megjelenő kétnapos dátumtartomány is ugyanabból a megye-alapú
// döntésből (lib/pickupInfo, lib/countyGroups) származik, mint éles
// rendelésnél.
const countyVariants = [
    { label: "Tanyasi átvétel (Békés megyei vásárló)", county: "Békés" },
    { label: "Városi átvétel (más megyei vásárló)", county: "Csongrád-Csanád" },
    { label: "DUNAVECSE (Bács-Kiskun megyei vásárló)", county: "Bács-Kiskun" },
];

export default async function AdminOrderConfirmationPreviewPage() {
    const supabase = await createClient();
    const activeSeason = await getActiveSeasonPickupTimes(supabase);

    // A Bács-Kiskun (DUNAVECSE) mintaváltozat a jelenleg aktív szezon valós
    // "vágási napját" (a DUNAVECSE nap pickup_date-jét, ami mindig a szezon
    // utolsó normál átvételi napjával egyezik) mutatja, ne egy elavult,
    // hardcode-olt dátumot.
    const { data: activeSeasonRow } = await supabase
        .from("season_parameters")
        .select("id")
        .eq("is_active", true)
        .maybeSingle();
    const { data: dunavecseDay } = activeSeasonRow
        ? await supabase
            .from("pickup_days")
            .select("pickup_date")
            .eq("season_parameter_id", activeSeasonRow.id)
            .eq("kind", "dunavecse")
            .maybeSingle()
        : { data: null };

    return (
        <div className="mx-auto w-full max-w-5xl">
            <div className="px-4 text-center sm:px-6">
                <div className="mt-2.5 flex items-center gap-4">
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                    <h1 className="shrink-0 text-md font-semibold tracking-wider text-gray-500">
                        Rendelés-visszaigazolás (weboldal)
                    </h1>
                    <span className="h-px flex-1 bg-gray-400" aria-hidden="true" />
                </div>
                <p className="mx-auto mt-2.5 max-w-4xl text-base leading-7 text-gray-600 italic">
                    A vásárló ezt a felületet látja közvetlenül az előrendelés sikeres
                    leadása után, az Előrendelés oldalon. Az alábbi három változat a
                    Békés megyei (tanyasi), a más megyei (városi) és a Bács-Kiskun
                    megyei (DUNAVECSE) átvételt mutatja, a jelenleg aktív szezon
                    átvételi időpontjaival.
                </p>
            </div>

            {!activeSeason ? (
                <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-700">
                    Nincs jelenleg aktív szezon beállítva, ezért az átvételi
                    időpont előnézete nem elérhető. Állítson be aktív szezont a
                    Szezonok oldalon, majd térjen vissza ide.
                </p>
            ) : (
                countyVariants.map(({ label, county }) => (
                    <div
                        key={county}
                        className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
                    >
                        <div className="border-b border-gray-200 bg-gray-50 px-5 py-3 text-center text-sm font-semibold text-gray-600 sm:px-7">
                            {label}
                        </div>
                        <div className="bg-[#f4f7f5] p-3 sm:p-6">
                            <OrderConfirmationSummary
                                {...sampleOrderConfirmation}
                                pickupDate={
                                    county === "Bács-Kiskun" && dunavecseDay?.pickup_date
                                        ? dunavecseDay.pickup_date
                                        : sampleOrderConfirmation.pickupDate
                                }
                                pickupTimeStart={activeSeason.pickupTimeStart}
                                pickupTimeEnd={activeSeason.pickupTimeEnd}
                                localPickupTimeStart={activeSeason.localPickupTimeStart}
                                userCounty={county}
                            />
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
