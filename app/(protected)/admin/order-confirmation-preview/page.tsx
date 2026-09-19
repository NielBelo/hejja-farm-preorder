import OrderConfirmationSummary from "@/components/OrderConfirmationSummary";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";

// Ugyanaz a komponens jelenik meg itt, mint amit a vásárló az Előrendelés
// oldalon lát a rendelés sikeres leadása után - a minta adatok csak a
// fejlesztői előnézethez kellenek, valódi rendelés nem jön létre. A megye
// viszont a bejelentkezett admin tényleges profilbeállítása, hogy a Békés
// megyei ág is valós adattal ellenőrizhető legyen ugyanazzal a komponenssel
// és döntési logikával, mint az éles előrendelési folyamatban.
const sampleOrderConfirmation = {
    orderNumber: "HF-777153",
    pickupDate: "2026-10-07",
    submittedAt: new Date("2026-09-16T23:42:00+02:00"),
    seasonEndDate: "2026-09-29T23:59:00+02:00",
    emailRecipient: "hejjafarm.admin@gmail.com",
    pickupTimeStart: "17:00",
    pickupTimeEnd: "18:15",
    localPickupTimeStart: "16:00",
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

export default async function AdminOrderConfirmationPreviewPage() {
    const currentUser = await getCurrentUser();

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
                    leadása után, az Előrendelés oldalon.
                </p>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="bg-[#f4f7f5] p-3 sm:p-6">
                    <OrderConfirmationSummary
                        {...sampleOrderConfirmation}
                        userCounty={currentUser?.county ?? null}
                    />
                </div>
            </div>
        </div>
    );
}
