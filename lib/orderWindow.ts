const BUDAPEST_TIME_ZONE = "Europe/Budapest";

const endDateFormatter = new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUDAPEST_TIME_ZONE,
});

// A "YYYY-MM-DD" naptári napot adja vissza Europe/Budapest időzóna szerint
// egy tetszőleges (pl. UTC-ben tárolt) időbélyegből. Bárhol, ahol egy
// time_window_start/time_window_end timestamptz-ből a szerkesztőűrlap vagy
// egy admin nézet naptári napot jelenít meg, EZT kell használni a naiv
// `.slice(0, 10)` string-vágás helyett - az utóbbi az UTC-ben szerializált
// ISO-string dátumrészét olvasná ki, ami éjféli (00:00 helyi) időpontok
// esetén Budapesten még az előző UTC-napra eshet, és eggyel korábbi dátumot
// mutatna.
export function getCalendarDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: BUDAPEST_TIME_ZONE,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");

    return year && month && day ? `${year}-${month}-${day}` : null;
}

function getBudapestOffset(calendarDate: string) {
    const offsetPart = new Intl.DateTimeFormat("en-US", {
        timeZone: BUDAPEST_TIME_ZONE,
        timeZoneName: "longOffset",
    }).formatToParts(new Date(`${calendarDate}T12:00:00Z`))
        .find((part) => part.type === "timeZoneName")
        ?.value;
    const offset = offsetPart?.replace("GMT", "");

    return offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
}

export function getOrderWindowStart(startDate?: string | null) {
    if (!startDate) {
        return null;
    }

    const calendarDate = getCalendarDate(startDate);

    if (!calendarDate) {
        return null;
    }

    const offset = getBudapestOffset(calendarDate);

    if (!offset) {
        return null;
    }

    const start = new Date(`${calendarDate}T00:00:00.000${offset}`);
    return Number.isNaN(start.getTime()) ? null : start;
}

export function getOrderWindowEnd(endDate?: string | null) {
    if (!endDate) {
        return null;
    }

    const calendarDate = getCalendarDate(endDate);

    if (!calendarDate) {
        return null;
    }

    const offset = getBudapestOffset(calendarDate);

    if (!offset) {
        return null;
    }

    const end = new Date(`${calendarDate}T23:59:59.999${offset}`);
    return Number.isNaN(end.getTime()) ? null : end;
}

export function formatOrderWindowEnd(endDate: string) {
    const end = getOrderWindowEnd(endDate);
    return end ? endDateFormatter.format(end) : endDate;
}
