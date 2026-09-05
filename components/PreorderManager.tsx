"use client";

import { useEffect, useRef, useState } from "react";
import CountdownCard from "@/components/CountdownCard";
import PickupDaySelector from "@/components/PickupDaySelector";
import ProductSelector from "@/components/ProductSelector";
import { createClient } from "@/lib/supabase/client";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import {
    submitOrder,
    type SubmitOrderItem,
} from "@/app/(protected)/preorder/actions";
import { formatOrderWindowEnd } from "@/lib/orderWindow";

type Product = {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
};

type PackageOption = {
    id: number;
    name: string;
    description: string | null;
};

type PickupDay = {
    id: number;
    year: number;
    season: number;
    serial_number: number;
    pickup_date: string;
    planned_stock: number;
    available_stock: number;
    _group: number;
    is_active: boolean;
};

type OrderItem = {
    selectedProductId: number | null;
    selectedPackageId: number | null;
    quantity: number;
    note: string;
    selectedNote: string;
    collapsed: boolean;
    touched: boolean;
    showValidation: boolean;
};

type SubmittedOrder = {
    orderNumber: string;
    pickupDay: PickupDay;
    items: OrderItem[];
    submittedAt: Date;
    emailRecipient?: string;
};

type Season = {
    id: number;
    time_window_start: string;
    time_window_end: string;
};


export default function PreorderManager({
    season,
    products,
    packages,
    pickupDays,
}: {
    season: Season;
    products: Product[];
    packages: PackageOption[];
    pickupDays: PickupDay[];
}) {
    const [selectedPickupDay, setSelectedPickupDay] = useState<PickupDay | null>(
        null
    );

    const [currentPickupDays, setCurrentPickupDays] =
        useState<PickupDay[]>(pickupDays);

    const handlePickupDayChange = (day: PickupDay) => {
        if (
            selectedPickupDay &&
            selectedPickupDay.id !== day.id &&
            hasOrderChanges
        ) {
            setPendingPickupDay(day);
            setShowDayChangeModal(true);
            return;
        }

        setSelectedPickupDay(day);
        setLastSubmittedOrder(null);
    };

    const confirmPickupDayChange = () => {
        if (!pendingPickupDay) return;

        setSelectedPickupDay(pendingPickupDay);
        setResetKey((prev) => prev + 1);

        setLastSubmittedOrder(null);
        setPendingPickupDay(null);
        setShowDayChangeModal(false);

    };

    const cancelPickupDayChange = () => {
        setPendingPickupDay(null);
        setShowDayChangeModal(false);
    };

    const [resetKey, setResetKey] = useState(0);

    const [pendingPickupDay, setPendingPickupDay] =
        useState<PickupDay | null>(null);

    const [showDayChangeModal, setShowDayChangeModal] =
        useState(false);

    const [hasOrderChanges, setHasOrderChanges] =
        useState(false);

    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

    const [emailWarning, setEmailWarning] = useState<string | null>(null);

    const validOrderItems = orderItems.filter(
        (item) =>
            item.selectedProductId !== null ||
            item.selectedPackageId !== null
    );

    const canSubmitOrder =
        selectedPickupDay !== null &&
        validOrderItems.length > 0 &&
        validOrderItems.every(
            (item) =>
                item.selectedProductId !== null &&
                item.selectedPackageId !== null &&
                item.collapsed
        );

    const refreshPickupDays = async () => {
        const supabase = createClient();

        const { data, error } = await supabase
            .from("pickup_days")
            .select("*")
            .order("serial_number");

        if (error) {
            console.error("Átvételi napok frissítési hiba:", error);
            return;
        }

        setCurrentPickupDays(data);

        if (selectedPickupDay) {
            const updatedSelectedDay = data.find(
                (day) => day.id === selectedPickupDay.id
            );

            if (updatedSelectedDay) {
                setSelectedPickupDay(updatedSelectedDay);
            }
        }
    };


    const handleFinalizeOrder = async () => {
        if (!canSubmitOrder || !selectedPickupDay) {
            return;
        }

        setSubmitError(null);
        setEmailWarning(null);

        const rpcItems = validOrderItems.map<SubmitOrderItem>((item) => ({
            product_id: item.selectedProductId!,
            package_id: item.selectedPackageId!,
            quantity: item.quantity,
            size_preference: item.selectedNote,
            note: item.note || null,
        }));

        console.log("RPC items:", rpcItems);
        console.log("Selected pickup day:", selectedPickupDay);

        const result = await submitOrder({
            seasonParameterId: season.id,
            pickupDayId: selectedPickupDay.id,
            items: rpcItems,
        });

        console.log("Order submission result:", result);

        await refreshPickupDays();

        if (!result.success || !result.orderNumber) {
            setSubmitError(result.error ?? "A rendelés véglegesítése sikertelen.");
            return;
        }

        setLastSubmittedOrder({
            orderNumber: result.orderNumber,
            pickupDay: selectedPickupDay,
            items: validOrderItems.map((item) => ({ ...item })),
            submittedAt: new Date(),
            emailRecipient: result.emailRecipient,
        });
        setResetKey((prev) => prev + 1);
        setOrderItems([]);
        setHasOrderChanges(false);
        setSelectedPickupDay(null);
        setEmailWarning(result.emailWarning ?? null);
    };


    const [submitError, setSubmitError] = useState<string | null>(null);

    const [lastSubmittedOrder, setLastSubmittedOrder] =
        useState<SubmittedOrder | null>(null);
    const confirmationRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!lastSubmittedOrder) return;

        confirmationRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }, [lastSubmittedOrder]);

    return (
        <>
            {season && (
                    <div className="mb-10">
                      <CountdownCard
                        startDate={season?.time_window_start}
                        endDate={season?.time_window_end}
                      /> 
                    </div>
                  )}

            {lastSubmittedOrder && (
                <div
                    ref={confirmationRef}
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
                                #{lastSubmittedOrder.orderNumber}
                            </span>
                        </div>

                        <div className="text-center">
                            Rögzítés időpontja:{" "}
                            <span className="font-semibold text-gray-700">
                                {lastSubmittedOrder.submittedAt.toLocaleString("hu-HU")}
                            </span>
                        </div>

                        <div className="text-right">
                            Átvétel:{" "}
                            <span className="font-semibold text-gray-700">
                                {new Date(
                                    lastSubmittedOrder.pickupDay.pickup_date
                                ).toLocaleDateString("hu-HU")}
                            </span>
                        </div>
                    </div>

                    <div className="mt-6">
                        {lastSubmittedOrder.items.map((item, index) => {
                            const product = products.find(
                                (product) => product.id === item.selectedProductId
                            );

                            const packageOption = packages.find(
                                (packageOption) => packageOption.id === item.selectedPackageId
                            );

                            return (
                                <div
                                    key={index}
                                    className={`
                            py-4 text-sm text-gray-600
                            ${index > 0
                                            ? "border-t border-gray-200"
                                            : ""
                                        }
                        `}
                                >
                                    <p className="font-semibold text-gray-700">
                                        {index + 1}. tétel
                                    </p>

                                    <p>
                                        {product?.name} – {item.quantity} db
                                    </p>

                                    <p>
                                        Csomagolás: {packageOption?.name}
                                    </p>

                                    <p>
                                        Méret: {item.selectedNote}
                                    </p>

                                    {item.note && (
                                        <p>
                                            Megjegyzés: {item.note}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-5 border-t border-gray-200 pt-5 text-center text-sm leading-6 text-gray-600">
                        <p>
                            Korábban leadott rendeléseit az{" "}
                            <span className="font-semibold text-gray-700">
                                Előzmények
                            </span>{" "}
                            oldalon tekintheti meg.
                        </p>

                        <p>
                            Rendelése az előrendelési időszak végéig,{" "}
                            <span className="font-semibold text-gray-700">
                                {formatOrderWindowEnd(season.time_window_end)}
                            </span>
                            -ig módosítható vagy törölhető.
                        </p>

                        {lastSubmittedOrder.emailRecipient && (
                            <p className="mt-2">
                                A(z){" "}
                                <span className="font-semibold text-gray-700">
                                    {lastSubmittedOrder.emailRecipient}
                                </span>{" "}
                                e-mail-címre visszaigazolást küldtünk, és a
                                rendelés átvétele előtt egy nappal újabb
                                automatikus emlékeztetőt fog kapni.
                            </p>
                        )}
                    </div>
                </div>
            )}

            <div className="mx-auto mt-6 mb-4 flex w-full max-w-4xl items-center gap-4">
                <div className="h-px flex-1 bg-gray-400" />

                <h2 className="text-md font-semibold tracking-wider text-gray-500">
                    ÚJ ELŐRENDELÉS
                </h2>

                <div className="h-px flex-1 bg-gray-400" />
            </div>

            <PickupDaySelector
                startDate={season?.time_window_start}
                endDate={season?.time_window_end}
                pickupDays={currentPickupDays}
                selectedPickupDayId={selectedPickupDay?.id ?? null}
                onSelectPickupDay={handlePickupDayChange}
            />

            <ProductSelector
                products={products}
                packages={packages}
                maxAvailableQuantity={selectedPickupDay?.available_stock ?? null}
                resetKey={resetKey}
                isPickupDaySelected={selectedPickupDay !== null}
                onOrderChangesChange={setHasOrderChanges}
                onItemsChange={setOrderItems}
                onItemEdited={() => {
                    setSubmitError(null);
                    setLastSubmittedOrder(null);
                }}
            />



            <div className="mt-10 border-t border-gray-300 pt-8">

                {validOrderItems.length > 0 &&
                    validOrderItems.some((item) => !item.collapsed) && (
                        <p className="mb-4 text-center text-sm font-medium text-gray-600">
                            A rendelés véglegesítéséhez először fejezze be az összes tételt!
                        </p>
                    )}

                {submitError && (
                    <p className="mb-4 text-center text-sm font-medium text-red-600">
                        {submitError}
                    </p>
                )}



                <div className="flex justify-center"></div>

                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={handleFinalizeOrder}
                        disabled={!canSubmitOrder}
                        className={`
                rounded-lg px-8 py-3 font-semibold text-white transition
                ${canSubmitOrder
                                ? "bg-[rgb(49,171,2)] hover:brightness-95"
                                : "cursor-not-allowed bg-gray-300"
                            }
            `}
                    >
                        Rendelés véglegesítése
                    </button>
                </div>
            </div>

            {showDayChangeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">

                        <h2 className="text-lg font-semibold text-gray-800">
                            Figyelem!
                        </h2>

                        <p className="mt-3 text-sm leading-6 text-gray-600">
                            Az átvételi nap módosításával a korábban megadott, de még nem véglegesített rendelési tételek
                            elvesznek. Folytatja?
                        </p>

                        <div className="mt-6 flex justify-end gap-3">

                            <button
                                type="button"
                                onClick={cancelPickupDayChange}
                                className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={confirmPickupDayChange}
                                className="rounded-lg bg-[rgb(49,171,2)] px-4 py-2 font-semibold text-white hover:brightness-95"
                            >
                                Folytatás
                            </button>

                        </div>

                    </div>
                </div>
            )}
        </>
    );
}
