const BUDAPEST_TIME_ZONE = "Europe/Budapest";

const endDateFormatter = new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUDAPEST_TIME_ZONE,
});

function getCalendarDate(value: string) {
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

export function getOrderWindowEnd(endDate?: string | null) {
    if (!endDate) {
        return null;
    }

    const calendarDate = getCalendarDate(endDate);

    if (!calendarDate) {
        return null;
    }

    const offsetPart = new Intl.DateTimeFormat("en-US", {
        timeZone: BUDAPEST_TIME_ZONE,
        timeZoneName: "longOffset",
    }).formatToParts(new Date(`${calendarDate}T12:00:00Z`))
        .find((part) => part.type === "timeZoneName")
        ?.value;
    const offset = offsetPart?.replace("GMT", "");

    if (!offset || !/^[+-]\d{2}:\d{2}$/.test(offset)) {
        return null;
    }

    const end = new Date(`${calendarDate}T23:59:59.999${offset}`);
    return Number.isNaN(end.getTime()) ? null : end;
}

export function formatOrderWindowEnd(endDate: string) {
    const end = getOrderWindowEnd(endDate);
    return end ? endDateFormatter.format(end) : endDate;
}
