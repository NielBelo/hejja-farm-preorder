"use client";

import { useEffect, useRef, useState } from "react";
import CountdownCard from "@/components/CountdownCard";
import InfoModal from "@/components/InfoModal";
import PickupDaySelector from "@/components/PickupDaySelector";
import SizeFitDialog from "@/components/SizeFitDialog";
import { fitItemsToSizeAvailability, type SizeFitResult } from "@/lib/sizeAvailability";
import ProductSelector from "@/components/ProductSelector";
import OrderConfirmationSummary from "@/components/OrderConfirmationSummary";
import { createClient } from "@/lib/supabase/client";
import { getCountyGroup, BACS_KISKUN_NOTE_LABEL } from "@/lib/countyGroups";
import { getBacsKiskunPickupRangeInfo } from "@/lib/pickupInfo";
import { useOrderWindow } from "@/lib/useOrderWindow";
import { getDisplayPickupDay } from "@/lib/orderingAvailability";
import {
    submitOrder,
    type SubmitOrderItem,
} from "@/app/(protected)/preorder/actions";

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
    image_url?: string | null;
};

type PickupDay = {
    id: number;
    year: number;
    season: number;
    serial_number: number;
    pickup_date: string;
    planned_stock: number | null;
    available_stock: number | null;
    _group: number;
    is_active: boolean;
};

type DunavecseDay = {
    id: number;
    pickup_date: string;
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
    validationPosition: "top" | "bottom";
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
    year?: number | null;
    season?: string | null;
    time_window_start: string;
    time_window_end: string;
    pickup_time_start: string | null;
    pickup_time_end: string | null;
    local_pickup_time_start: string | null;
};

// A get_pickup_day_size_availability() sorai: naponként a még rendelhető
// kisebb/nagyobb méretű csirkék száma (null = nincs korlát az adott méretre).
// A korlát nélküli napok nem szerepelnek a listában.
export type SizeAvailabilityRow = {
    pickup_day_id: number;
    small_remaining: number | null;
    large_remaining: number | null;
};

const ORDERING_CLOSED_MESSAGE =
    "Jelenleg nincs lehetőség előrendelésre! A rendelés leadása csak a rendelési időszakban lehetséges.";

export default function PreorderManager({
    season,
    products,
    packages,
    pickupDays,
    dunavecseDay = null,
    userCounty,
    sizeAvailabilityRows = [],
    productPrices,
}: {
    season: Season;
    products: Product[];
    packages: PackageOption[];
    pickupDays: PickupDay[];
    dunavecseDay?: DunavecseDay | null;
    userCounty?: string | null;
    sizeAvailabilityRows?: SizeAvailabilityRow[];
    productPrices?: Record<number, number>;
}) {
    // A megye alapján a három csoport (Békés, Bács-Kiskun, egyéb) központi
    // felismerése - lásd lib/countyGroups.ts. Bács-Kiskun megyei
    // vásárlónál nincs átvételi nap választás: a rendelés automatikusan a
    // szezon DUNAVECSE napjához kerül, amit itt egy PickupDay-alakú
    // "virtuális" objektumként kezelünk, hogy a meglévő ProductSelector/
    // OrderConfirmationSummary logika (maxAvailableQuantity, pickupDate stb.)
    // változtatás nélkül újrahasználható legyen.
    const isBacsKiskun = getCountyGroup(userCounty) === "bacsKiskun";

    // A rendelési időablak mindkét csoportnál ugyanazt a tiltást adja: lejárt
    // (vagy még nem kezdődött) időablaknál nincs aktív átvételi nap, így a
    // termékválasztás és a véglegesítés sem érhető el.
    const isOrderingOpen = useOrderWindow(
        season?.time_window_start,
        season?.time_window_end
    );

    const [selectedPickupDay, setSelectedPickupDay] = useState<PickupDay | null>(
        null
    );

    const [currentPickupDays, setCurrentPickupDays] =
        useState<PickupDay[]>(pickupDays);

    const [currentSizeAvailabilityRows, setCurrentSizeAvailabilityRows] =
        useState<SizeAvailabilityRow[]>(sizeAvailabilityRows);

    const [currentDunavecseDay, setCurrentDunavecseDay] =
        useState<DunavecseDay | null>(dunavecseDay);

    const dunavecsePickupDay: PickupDay | null = currentDunavecseDay
        ? {
            id: currentDunavecseDay.id,
            year: 0,
            season: 0,
            serial_number: 0,
            pickup_date: currentDunavecseDay.pickup_date,
            planned_stock: null,
            available_stock: null,
            _group: 0,
            is_active: currentDunavecseDay.is_active,
        }
        : null;

    // Bács-Kiskun megyei vásárlónál nincs napválasztás: a ténylegesen
    // "aktívan kezelt" nap az aktív DUNAVECSE nap, minden más vásárlónál a
    // kézzel kiválasztott nap. Ezt render közben származtatjuk (nem
    // effektussal szinkronizáljuk state-be), hogy ne legyen felesleges,
    // kaszkádoló renderelés.
    const displayPickupDay: PickupDay | null = getDisplayPickupDay({
        isOrderingOpen,
        isBacsKiskun,
        selectedPickupDay,
        dunavecsePickupDay,
    });

    // A kiválasztott nap méretkerete (nincs sor = az adott napon nincs korlát).
    const selectedSizeRow = displayPickupDay
        ? currentSizeAvailabilityRows.find((row) => row.pickup_day_id === displayPickupDay.id)
        : undefined;
    const sizeAvailability = selectedSizeRow
        ? { small: selectedSizeRow.small_remaining, large: selectedSizeRow.large_remaining }
        : null;

    const handlePickupDayChange = (day: PickupDay) => {
        if (
            selectedPickupDay &&
            selectedPickupDay.id !== day.id &&
            hasOrderChanges
        ) {
            // Ugyanaz az összegzés, mint a ProductSelector getRemainingQuantity
            // "used" számítása: az összes tétel mennyiségét számoljuk, függetlenül
            // attól, hogy a tétel már össze van-e csukva vagy van-e már
            // kiválasztott terméke/csomagolása.
            const requiredQuantity = orderItems.reduce(
                (sum, item) => sum + item.quantity,
                0
            );

            if (requiredQuantity > (day.available_stock ?? 0)) {
                setPendingPickupDay(day);
                setShowDayChangeModal(true);
                return;
            }

            const dayRow = currentSizeAvailabilityRows.find((row) => row.pickup_day_id === day.id);
            const fit = fitItemsToSizeAvailability(
                orderItems,
                dayRow ? { small: dayRow.small_remaining, large: dayRow.large_remaining } : null
            );

            if (fit.changed) {
                setPendingSizeFit({ day, fit });
                return;
            }
        }

        setSelectedPickupDay(day);
        setTermsAccepted(false);
        setLastSubmittedOrder(null);
    };

    const confirmPickupDayChange = () => {
        if (!pendingPickupDay) return;

        setSelectedPickupDay(pendingPickupDay);
        setTermsAccepted(false);
        setFittedItems(undefined);
        setResetKey((prev) => prev + 1);

        setLastSubmittedOrder(null);
        setPendingPickupDay(null);
        setShowDayChangeModal(false);

    };

    const confirmSizeFit = () => {
        if (!pendingSizeFit) return;

        setSelectedPickupDay(pendingSizeFit.day);
        setTermsAccepted(false);
        setLastSubmittedOrder(null);
        setFittedItems(pendingSizeFit.fit.items);
        setResetKey((prev) => prev + 1);
        setPendingSizeFit(null);
    };

    const cancelPickupDayChange = () => {
        setPendingPickupDay(null);
        setShowDayChangeModal(false);
    };

    const [resetKey, setResetKey] = useState(0);

    // A napváltáskor a méretkerethez igazított tételek: a szerkesztő ezekből
    // indul újra. Minden más alaphelyzetbe állításnál (resetKey) törölni kell.
    const [fittedItems, setFittedItems] = useState<OrderItem[] | undefined>(undefined);

    const [pendingSizeFit, setPendingSizeFit] = useState<{
        day: PickupDay;
        fit: SizeFitResult<OrderItem>;
    } | null>(null);

    const [pendingPickupDay, setPendingPickupDay] =
        useState<PickupDay | null>(null);

    const [showDayChangeModal, setShowDayChangeModal] =
        useState(false);

    const [hasOrderChanges, setHasOrderChanges] =
        useState(false);

    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

    const [emailWarning, setEmailWarning] = useState<string | null>(null);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [termsModalOpen, setTermsModalOpen] = useState(false);

    const validOrderItems = orderItems.filter(
        (item) =>
            item.selectedProductId !== null ||
            item.selectedPackageId !== null
    );

    const refreshPickupDays = async () => {
        const supabase = createClient();

        const { data, error } = await supabase
            .from("pickup_days")
            .select("*")
            .eq("is_active", true)
            .eq("kind", "normal")
            .order("_group")
            .order("serial_number");

        if (error) {
            console.error("Átvételi napok frissítési hiba:", error);
            return;
        }

        setCurrentPickupDays(data);

        if (selectedPickupDay && !isBacsKiskun) {
            const updatedSelectedDay = data.find(
                (day) => day.id === selectedPickupDay.id
            );

            if (updatedSelectedDay) {
                setSelectedPickupDay(updatedSelectedDay);
            }
        }

        if (season?.id) {
            const { data: dunavecse } = await supabase
                .from("pickup_days")
                .select("id, pickup_date, is_active")
                .eq("season_parameter_id", season.id)
                .eq("kind", "dunavecse")
                .maybeSingle();

            setCurrentDunavecseDay(dunavecse ?? null);
        }

        const { data: sizeRows, error: sizeError } = await supabase.rpc(
            "get_pickup_day_size_availability"
        );

        if (sizeError) {
            console.error("Méretkeret frissítési hiba:", sizeError);
            return;
        }

        setCurrentSizeAvailabilityRows((sizeRows ?? []) as SizeAvailabilityRow[]);
    };


    // Ref-based guard: synchronous, so it blocks a second call that arrives in the
    // same event-loop tick, before the isSubmitting state update above could commit.
    const isSubmittingRef = useRef(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleFinalizeOrder = async () => {
        if (isSubmittingRef.current) return;

        if (!isOrderingOpen) {
            setSubmitError(ORDERING_CLOSED_MESSAGE);
            return;
        }

        if (isBacsKiskun) {
            if (!dunavecsePickupDay?.is_active) {
                setSubmitError(
                    "A jelenlegi szezonban átmenetileg nem lehetséges rendelést leadni Bács-Kiskun megyei vásárlóként. Kérjük, próbálja meg később, vagy keresse az adminisztrátort."
                );
                return;
            }
        } else if (!selectedPickupDay) {
            setSubmitError("Válasszon átvételi napot a rendelés véglegesítéséhez!");
            return;
        }

        if (validOrderItems.length === 0) {
            setSubmitError("Adjon meg legalább egy rendelési tételt a véglegesítéshez!");
            return;
        }

        if (validOrderItems.some((item) => !item.collapsed)) {
            setSubmitError("Fejezze be az összes rendelési tételt a véglegesítés előtt!");
            return;
        }

        if (!termsAccepted) {
            setSubmitError("A véglegesítéshez fogadja el a szerződési feltételeket!");
            return;
        }

        if (!displayPickupDay) {
            setSubmitError("Válasszon átvételi napot a rendelés véglegesítéséhez!");
            return;
        }

        // From here on this is a valid submit attempt: block any further calls
        // (double click/tap, duplicate event) immediately and synchronously.
        isSubmittingRef.current = true;
        setIsSubmitting(true);

        setSubmitError(null);
        setEmailWarning(null);

        try {
            const rpcItems = validOrderItems.map<SubmitOrderItem>((item) => ({
                product_id: item.selectedProductId!,
                package_id: item.selectedPackageId!,
                quantity: item.quantity,
                size_preference: item.selectedNote,
                note: item.note || null,
            }));

            const result = await submitOrder({
                seasonParameterId: season.id,
                pickupDayId: displayPickupDay.id,
                items: rpcItems,
            });

            await refreshPickupDays();

            if (!result.success || !result.orderNumber) {
                setSubmitError(result.error ?? "A rendelés véglegesítése sikertelen.");
                return;
            }

            setLastSubmittedOrder({
                orderNumber: result.orderNumber,
                pickupDay: displayPickupDay,
                items: validOrderItems.map((item) => ({ ...item })),
                submittedAt: new Date(),
                emailRecipient: result.emailRecipient,
            });
            setFittedItems(undefined);
            setResetKey((prev) => prev + 1);
            setOrderItems([]);
            setHasOrderChanges(false);
            setSelectedPickupDay(null);
            setTermsAccepted(false);
            setEmailWarning(result.emailWarning ?? null);
        } finally {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
        }
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

    const pickupDaySectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!selectedPickupDay) return;

        // Double rAF: ProductSelector reacts to isPickupDaySelected in its own effect
        // (a separate, later commit) and expands the item panel. A single rAF can still
        // fire before that second commit has been painted, so we wait for one extra frame
        // to guarantee the expanded layout is settled before measuring the scroll target.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                pickupDaySectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            });
        });
        // Only re-scroll when the selected day itself changes, not when refreshPickupDays() updates its stock numbers.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPickupDay?.id]);

    return (
        <>
            {season && (
                    <div className="mb-10">
                      <CountdownCard
                        startDate={season?.time_window_start}
                        endDate={season?.time_window_end}
                        seasonYear={season?.year}
                        seasonName={season?.season}
                      /> 
                    </div>
                  )}

            {lastSubmittedOrder && (
                <OrderConfirmationSummary
                    ref={confirmationRef}
                    orderNumber={lastSubmittedOrder.orderNumber}
                    pickupDate={lastSubmittedOrder.pickupDay.pickup_date}
                    submittedAt={lastSubmittedOrder.submittedAt}
                    seasonEndDate={season.time_window_end}
                    emailRecipient={lastSubmittedOrder.emailRecipient}
                    emailWarning={emailWarning}
                    pickupTimeStart={season.pickup_time_start}
                    pickupTimeEnd={season.pickup_time_end}
                    localPickupTimeStart={season.local_pickup_time_start}
                    userCounty={userCounty}
                    items={lastSubmittedOrder.items.map((item) => ({
                        productName: products.find(
                            (product) => product.id === item.selectedProductId
                        )?.name ?? "",
                        pricePerKg: item.selectedProductId != null
                            ? productPrices?.[item.selectedProductId] ?? null
                            : null,
                        packageName: packages.find(
                            (packageOption) => packageOption.id === item.selectedPackageId
                        )?.name ?? "",
                        quantity: item.quantity,
                        sizePreference: item.selectedNote,
                        note: item.note,
                    }))}
                />
            )}

            <div className="mx-auto mt-6 mb-4 flex w-full max-w-4xl items-center gap-4">
                <div className="h-px flex-1 bg-gray-400" />

                <h2
                    className={`text-xl font-semibold tracking-wider ${
                        isBacsKiskun ? "text-gray-700" : "text-gray-500"
                    }`}
                >
                    {isBacsKiskun ? "ELŐRENDELÉS (DUNAVECSE)" : "ELŐRENDELÉS"}
                </h2>

                <div className="h-px flex-1 bg-gray-400" />
            </div>

            <div ref={pickupDaySectionRef} className="scroll-mt-24">
                {isBacsKiskun ? (
                    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        {!isOrderingOpen ? (
                            <>
                                <h3 className="text-center text-xl font-semibold text-gray-700">
                                    Jelenleg nincs lehetőség előrendelésre!
                                </h3>
                                <p className="mt-2 text-center text-lg font-semibold text-gray-700">
                                    A következő előrendelési lehetőségről e-mailben értesítjük.
                                </p>
                            </>
                        ) : dunavecsePickupDay?.is_active ? (
                            <p className="text-center text-lg font-semibold text-gray-700">
                                Vágási nap:{" "}
                                <span className="text-[rgb(67,133,45)]">
                                    {getBacsKiskunPickupRangeInfo(dunavecsePickupDay.pickup_date).cuttingDayLabel}
                                </span>
                            </p>
                        ) : (
                            <p className="text-center text-lg font-semibold text-gray-700">
                                A jelenlegi szezonban átmenetileg nem lehetséges rendelést leadni Bács-Kiskun megyei vásárlóként. Kérjük, próbálja meg később, vagy keresse az adminisztrátort.
                            </p>
                        )}
                    </section>
                ) : (
                    <PickupDaySelector
                        startDate={season?.time_window_start}
                        endDate={season?.time_window_end}
                        pickupDays={currentPickupDays}
                        selectedPickupDayId={selectedPickupDay?.id ?? null}
                        onSelectPickupDay={handlePickupDayChange}
                    />
                )}
            </div>

            {isOrderingOpen && (
            <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-center text-xl font-semibold text-gray-700">
                    Adja meg a rendelési tétel(eke)t!
                </h2>

                <ProductSelector
                    products={products}
                    packages={packages}
                    maxAvailableQuantity={displayPickupDay?.available_stock ?? null}
                    sizeAvailability={sizeAvailability}
                    productPrices={productPrices}
                    resetKey={resetKey}
                    initialItems={fittedItems}
                    isPickupDaySelected={displayPickupDay !== null}
                    pickupDate={displayPickupDay?.pickup_date ?? null}
                    noteLabel={isBacsKiskun ? BACS_KISKUN_NOTE_LABEL : undefined}
                    onOrderChangesChange={setHasOrderChanges}
                    onItemsChange={setOrderItems}
                    onItemEdited={() => {
                        setSubmitError(null);
                        setLastSubmittedOrder(null);
                    }}
                />
            </section>
            )}



            {displayPickupDay && (
            <div className="mt-10 pt-8">

                {validOrderItems.length > 0 &&
                    validOrderItems.some((item) => !item.collapsed) && (
                        <p className="mb-4 text-center text-base font-medium text-gray-700">
                            A rendelés véglegesítéséhez először fejezze be az összes tételt!
                        </p>
                    )}

                {submitError && (
                    <p className="mb-4 text-center text-base font-medium text-red-600">
                        {submitError}
                    </p>
                )}



                <div className="mx-auto mb-5 flex max-w-xl items-start justify-center gap-3 text-base text-gray-700">
                    <input
                        id="terms-accepted"
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(event) => setTermsAccepted(event.target.checked)}
                        className="mt-1 h-5 w-5 shrink-0 accent-[rgb(138,115,85)]"
                    />
                    <label htmlFor="terms-accepted" className="leading-6">
                        Elfogadom a{" "}
                        <button
                            type="button"
                            onClick={() => setTermsModalOpen(true)}
                            className="font-semibold text-[rgb(108,90,66)] underline underline-offset-2 hover:text-[rgb(84,70,52)]"
                        >
                            szerződési feltételeket
                        </button>
                        .
                    </label>
                </div>

                <div className="flex justify-center">
                    <button
                        type="button"
                        onClick={handleFinalizeOrder}
                        disabled={isSubmitting}
                        aria-busy={isSubmitting}
                        className="rounded-lg bg-[rgb(67,133,45)] px-10 py-4 text-lg font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSubmitting ? "Rendelés folyamatban…" : "Rendelés véglegesítése"}
                    </button>
                </div>
            </div>
            )}

            {termsModalOpen && (
                <InfoModal
                    title="Általános Szerződési Feltételek"
                    subtitle="Hatályos: 2026. szeptember 22."
                    onClose={() => setTermsModalOpen(false)}
                >
                    <section>
                        <h3 className="font-semibold text-gray-800">1. Általános rendelkezések</h3>
                        <p className="mt-1">
                            A Héjja Ökofarm weboldala a termékek előrendelésére és az előrendelések kezelésére szolgál. A weboldalon online fizetés nem történik.
                        </p>
                    </section>

                    <section>
                        <h3 className="font-semibold text-gray-800">2. Előrendelés</h3>
                        <p className="mt-1">
                            A vásárló a weboldalon elérhető termékekre, a feltüntetett feltételek szerint adhat le előrendelést.
                        </p>
                        <p className="mt-2">
                            A sikeresen rögzített előrendelésről a rendszer visszaigazolást küld. Az előrendelés a weboldalon feltüntetett rendelési időszakon belül módosítható vagy törölhető.
                        </p>
                    </section>

                    <section>
                        <h3 className="font-semibold text-gray-800">3. Árak, átvétel és fizetés</h3>
                        <p className="mt-1">
                            A weboldalon a termékek egységára kerül feltüntetésre. A ténylegesen fizetendő összeg a termék átvételkori súlya és a feltüntetett egységár alapján kerül meghatározásra.
                        </p>
                        <p className="mt-2">
                            A termékek átvétele személyesen történik. A fizetés az átvételkor esedékes.
                        </p>
                    </section>

                    <section>
                        <h3 className="font-semibold text-gray-800">4. Teljesítés</h3>
                        <p className="mt-1">
                            Amennyiben az előrendelés teljesítése előre nem látható okból nem vagy csak részben lehetséges, a Héjja Ökofarm erről tájékoztatja a vásárlót.
                        </p>
                    </section>

                    <section>
                        <h3 className="font-semibold text-gray-800">5. Elállás és panaszkezelés</h3>
                        <p className="mt-1">
                            A romlandó vagy minőségüket rövid ideig megőrző termékekre a jogszabály szerinti indokolás nélküli elállási jog nem alkalmazható.
                        </p>
                        <p className="mt-2">
                            Az előrendeléssel vagy a termékkel kapcsolatos kérdés, észrevétel vagy panasz a Héjja Ökofarm elérhetőségein jelezhető.
                        </p>
                    </section>

                    <section>
                        <h3 className="font-semibold text-gray-800">6. Záró rendelkezések</h3>
                        <p className="mt-1">
                            Az előrendelés leadásával a vásárló kijelenti, hogy a jelen Általános Szerződési Feltételeket megismerte és elfogadja.
                        </p>
                        <p className="mt-2">
                            A jelen feltételekben nem szabályozott kérdésekben a mindenkor hatályos magyar jogszabályok rendelkezései irányadók.
                        </p>
                    </section>
                </InfoModal>
            )}

            {pendingSizeFit && (
                <SizeFitDialog
                    reducedCount={pendingSizeFit.fit.reducedCount}
                    removedCount={pendingSizeFit.fit.removedCount}
                    onConfirm={confirmSizeFit}
                    onCancel={() => setPendingSizeFit(null)}
                />
            )}

            {showDayChangeModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl">

                        <h2 className="text-2xl font-semibold text-gray-800">
                            Figyelem!
                        </h2>

                        <p className="mt-4 text-lg leading-7 text-gray-600">
                            A kiválasztott átvételi napon nincs elegendő készlet a jelenleg megadott rendelési tételek
                            teljes mennyiségéhez. Ha folytatja, a korábban megadott, de még nem véglegesített
                            rendelési tételek törlődnek, és a rendszer átvált az új napra.
                        </p>

                        <div className="mt-8 flex justify-end gap-3">

                            <button
                                type="button"
                                onClick={cancelPickupDayChange}
                                className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100"
                            >
                                Mégse
                            </button>

                            <button
                                type="button"
                                onClick={confirmPickupDayChange}
                                className="rounded-lg bg-[rgb(67,133,45)] px-5 py-3 text-base font-semibold text-white hover:brightness-95"
                            >
                                Váltás, tételek törlése
                            </button>

                        </div>

                    </div>
                </div>
            )}
        </>
    );
}
