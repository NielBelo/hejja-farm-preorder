// Az átvételi időpont és helyszín megyétől függő kiválasztása - ugyanazt a
// szabályt kell alkalmazni a webes rendelés-visszaigazoló ablakban
// (components/OrderConfirmationSummary.tsx) és a rendelési e-mailekben
// (lib/email/orderNotification.ts) is, ezért ez a döntési logika és a
// dátum/idő formázás közös helperben él. Nincs "server-only" jelölés, mert a
// webes visszaigazolás a böngészőben (kliens oldalon) is felhasználja.
//
// A Bács-Kiskun vármegyei vásárlóknak nincs átvételi helyszínük/idejük (lásd
// getBacsKiskunPickupRangeInfo lent) - ezt a getPickupWindowInfo hívói döntik
// el a lib/countyGroups helperrel, ez a függvény csak a Békés/egyéb
// megkülönböztetést végzi.
import { isBekesCounty } from "@/lib/countyGroups";

const BUDAPEST_TIME_ZONE = "Europe/Budapest";

const BEKES_LOCATION =
    "Kútvölgy Tanya 1132/A, Hódmezővásárhely – Héjja Ökofarm";
const DEFAULT_LOCATION =
    "Hódmezővásárhely, Vámház u. 8/A – Albert Garden Kertészeti Áruda parkolójában";

const pickupMonthDayFormatter = new Intl.DateTimeFormat("hu-HU", {
    month: "long",
    day: "numeric",
    timeZone: BUDAPEST_TIME_ZONE,
});

const pickupWeekdayFormatter = new Intl.DateTimeFormat("hu-HU", {
    weekday: "long",
    timeZone: BUDAPEST_TIME_ZONE,
});

export { isBekesCounty, isBacsKiskunCounty } from "@/lib/countyGroups";

// A season_parameters idő oszlopai "HH:MM:SS" formában érkeznek a
// Supabase-től; a megjelenítéshez "HH:MM" kell.
function toHoursAndMinutes(value: string) {
    return value.slice(0, 5);
}

export type PickupWindowInput = {
    pickupDate: string;
    pickupTimeStart?: string | null;
    pickupTimeEnd?: string | null;
    localPickupTimeStart?: string | null;
    county?: string | null;
};

export type PickupWindowInfo = {
    /** pl. "október 7. (szerda)" */
    dateLabel: string;
    /**
     * Békés megyénél csak a kezdő időpont, pl. "15:00" (a tanyasi átvételnek
     * nincs önálló befejező időpontja), egyéb megyénél időtartomány, pl.
     * "17:00 - 18:15". Null, ha nincs elég adat.
     */
    timeRange: string | null;
    /** dateLabel és timeRange összefűzve, pl. "október 7. (szerda) 17:00 - 18:15" */
    windowLabel: string;
    /** a megyének megfelelő átvételi helyszín (felkiáltójel nélkül) */
    location: string;
};

export function getPickupWindowInfo({
    pickupDate,
    pickupTimeStart,
    pickupTimeEnd,
    localPickupTimeStart,
    county,
}: PickupWindowInput): PickupWindowInfo {
    const bekes = isBekesCounty(county);

    // Csak a dátumrésszel dolgozunk, dél (UTC) időponttal, hogy a szerver
    // saját időzónájától függetlenül mindig a helyes naptári napra essen.
    const dateOnly = pickupDate.split("T", 1)[0];
    const date = new Date(`${dateOnly}T12:00:00Z`);
    const dateLabel = Number.isNaN(date.getTime())
        ? dateOnly
        : `${pickupMonthDayFormatter.format(date)} (${pickupWeekdayFormatter.format(date)})`;

    // A tanyasi (Békés megyei) átvételnek nincs befejező időpontja, ezért
    // csak a helyi kezdő időt mutatjuk; a városi átvétel a teljes
    // időtartományt (kezdő - befejező) jeleníti meg.
    const timeRange = bekes
        ? (localPickupTimeStart ? toHoursAndMinutes(localPickupTimeStart) : null)
        : (pickupTimeStart && pickupTimeEnd
            ? `${toHoursAndMinutes(pickupTimeStart)} - ${toHoursAndMinutes(pickupTimeEnd)}`
            : null);

    const location = bekes ? BEKES_LOCATION : DEFAULT_LOCATION;

    return {
        dateLabel,
        timeRange,
        windowLabel: timeRange ? `${dateLabel} ${timeRange}` : dateLabel,
        location,
    };
}

export type BacsKiskunPickupRangeInfo = {
    /** a "vágási nap", pl. "október 6." - ugyanaz, mint a /preorder oldalon */
    cuttingDayLabel: string;
    /** kétnapos dátumtartomány, pl. "október 6. – 7." vagy "október 31. – november 1." */
    rangeLabel: string;
};

// A Bács-Kiskun vármegyei vásárlóknak nincs átvételi helyszínük/idejük -
// helyette a szezon utolsó normál átvételi napja ("vágási nap") és az azt
// követő naptári nap alkotta kétnapos dátumtartomány jelenik meg. A
// hónap-/évváltást valódi dátumművelettel (setUTCDate), nem szöveges
// számösszeadással kezeljük.
export function getBacsKiskunPickupRangeInfo(
    cuttingDate: string,
): BacsKiskunPickupRangeInfo {
    const dateOnly = cuttingDate.split("T", 1)[0];
    const start = new Date(`${dateOnly}T12:00:00Z`);

    if (Number.isNaN(start.getTime())) {
        return { cuttingDayLabel: dateOnly, rangeLabel: dateOnly };
    }

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const cuttingDayLabel = pickupMonthDayFormatter.format(start);
    const sameMonth =
        start.getUTCFullYear() === end.getUTCFullYear() &&
        start.getUTCMonth() === end.getUTCMonth();

    const rangeEndLabel = sameMonth
        ? `${end.getUTCDate()}.`
        : pickupMonthDayFormatter.format(end);

    return {
        cuttingDayLabel,
        rangeLabel: `${cuttingDayLabel} – ${rangeEndLabel}`,
    };
}
