import { forwardRef } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { formatOrderWindowEnd } from "@/lib/orderWindow";
import { getPickupWindowInfo } from "@/lib/pickupInfo";

export type OrderConfirmationItem = {
    productName: string;
    packageName: string;
    quantity: number;
    sizePreference: string;
    note?: string | null;
};

export type OrderConfirmationSummaryProps = {
    orderNumber: string;
    pickupDate: string;
    submittedAt: Date;
    items: OrderConfirmationItem[];
    seasonEndDate: string;
    emailRecipient?: string;
    emailWarning?: string | null;
    pickupTimeStart?: string | null;
    pickupTimeEnd?: string | null;
    localPickupTimeStart?: string | null;
    userCounty?: string | null;
};

// Az előrendelés sikeres leadása után megjelenő visszaigazoló felület.
// Ugyanezt a komponenst használja az éles előrendelési folyamat
// (PreorderManager) és az admin fejlesztői előnézet is, hogy a design és a
// tartalom egy helyen legyen karbantartható.
const OrderConfirmationSummary = forwardRef<HTMLDivElement, OrderConfirmationSummaryProps>(
    function OrderConfirmationSummary(
        {
            orderNumber,
            pickupDate,
            submittedAt,
            items,
            seasonEndDate,
            emailRecipient,
            emailWarning,
            pickupTimeStart,
            pickupTimeEnd,
            localPickupTimeStart,
            userCounty,
        },
        ref
    ) {
        const { windowLabel: pickupWindowLabel, location: pickupLocation } =
            getPickupWindowInfo({
                pickupDate,
                pickupTimeStart,
                pickupTimeEnd,
                localPickupTimeStart,
                county: userCounty,
            });

        return (
            <div
                ref={ref}
                className="mt-4 scroll-mt-24 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
            >
                <div className="mb-2 flex justify-center">
                    <CheckCircleIcon className="h-10 w-10 text-[rgb(49,171,2)]" />
                </div>
                <h3 className="text-center text-lg font-semibold text-[rgb(49,171,2)]">
                    Előrendelés sikeresen leadva!
                </h3>

                {emailWarning && (
                    <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-700">
                        {emailWarning}
                    </p>
                )}

                <div className="mt-3 grid grid-cols-3 items-center border-b border-gray-200 pb-4 text-sm text-gray-600">
                    <div className="text-left">
                        Rendelésszám:{" "}
                        <span className="font-semibold text-gray-700">
                            #{orderNumber}
                        </span>
                    </div>

                    <div className="text-center">
                        <span className="inline-block whitespace-nowrap rounded-md bg-blue-100 px-2.5 py-1 text-lg font-semibold text-gray-800">
                            Átvétel: {pickupWindowLabel}
                        </span>
                    </div>

                    <div className="text-right">
                        Rögzítés időpontja:{" "}
                        <span className="font-semibold text-gray-700">
                            {new Intl.DateTimeFormat("hu-HU", {
                                dateStyle: "short",
                                timeStyle: "short",
                            }).format(submittedAt)}
                        </span>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {items.map((item, index) => (
                        <div
                            key={index}
                            className="rounded-lg border border-[rgba(92,113,190,0.35)] bg-[rgba(92,113,190,0.07)] p-3 text-base text-gray-700"
                        >
                            <p className="font-semibold text-[rgb(55,75,150)]">
                                {index + 1}. tétel: {item.productName}
                            </p>

                            <p className="mt-1">
                                {item.quantity} db · Csomagolás: {item.packageName} · Méret: {item.sizePreference}
                            </p>

                            {item.note && (
                                <p className="mt-1 text-gray-600">
                                    Megjegyzés: {item.note}
                                </p>
                            )}
                        </div>
                    ))}
                </div>

                <div className="mt-5 border-t border-gray-200 pt-5 text-center text-base leading-6 text-gray-600">
                    <p>
                        Korábban leadott rendeléseit az{" "}
                        <span className="font-semibold text-gray-700">
                            Előzmények
                        </span>{" "}
                        oldalon tekintheti meg. Rendelése az előrendelési időszak végéig,{" "}
                        <span className="font-semibold text-gray-700">
                            {formatOrderWindowEnd(seasonEndDate)}
                        </span>
                        -ig módosítható vagy törölhető.
                        {emailRecipient && (
                            <> A(z){" "}
                            <span className="font-semibold text-gray-700">
                                {emailRecipient}
                            </span>{" "}
                            e-mail-címre visszaigazolást küldtünk, és a
                            rendelés átvétele előtt egy nappal újabb
                            automatikus emlékeztetőt fog kapni.
                            </>
                        )}
                        {" "}Átvétel helyszíne:{" "}
                        <span className="font-semibold text-gray-700">
                            {pickupLocation}
                        </span>
                        !
                    </p>
                </div>
            </div>
        );
    }
);

export default OrderConfirmationSummary;
