import { getCalendarDate } from "../lib/orderWindow";

const BUDAPEST_TIME_ZONE = "Europe/Budapest";

// A Cloudflare cron csak UTC-ben ütemezhető, ezért a scheduled trigger két
// UTC időpontban fut (lásd wrangler.jsonc: "0 6 * * *" és "0 7 * * *") -
// nyári időszámításkor a 06:00 UTC, télin a 07:00 UTC futás esik egybe a
// Budapest szerinti 08:00-val. Fix UTC eltolás beégetése helyett minden
// futáskor az Intl API-val olvassuk ki az aktuális Europe/Budapest
// falióra-órát, ami saját maga követi a nyári/téli időszámítás-váltást -
// így nem kell kézzel karbantartani, mikor változik az óraátállítás napja.
const REMINDER_HOUR_BUDAPEST = 8;

function getBudapestHour(now: Date): number {
    const hourPart = new Intl.DateTimeFormat("en-US", {
        timeZone: BUDAPEST_TIME_ZONE,
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(now).find((part) => part.type === "hour")?.value;

    return hourPart ? Number(hourPart) : NaN;
}

// Csak akkor fusson tovább a reminder-logika, ha Budapest szerint épp 08
// óra van - a másik napi UTC cron-futás (amikor ez még/már nem igaz)
// azonnal kilép, mielőtt bármilyen rendelést vagy e-mailt érintene.
export function shouldRunReminderJob(now: Date): boolean {
    return getBudapestHour(now) === REMINDER_HOUR_BUDAPEST;
}

// A "holnapi" pickup date Europe/Budapest naptári nap szerint számítva, nem
// UTC dátumból - ugyanaz a minta, mint lib/pickupInfo.ts
// getBacsKiskunPickupRangeInfo-ja: a mai budapesti naptári napot dél (UTC)
// időponttal rögzítjük, majd erre végzünk valódi naptári napléptetést
// (setUTCDate), hogy hónap-/évváltásnál és az óraátállítás körüli napokon
// is helyes maradjon.
export function getTomorrowPickupDateIso(now: Date): string {
    const todayBudapest = getCalendarDate(now.toISOString());

    if (!todayBudapest) {
        throw new Error("A mai budapesti naptári dátum nem határozható meg.");
    }

    const tomorrow = new Date(`${todayBudapest}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const year = tomorrow.getUTCFullYear();
    const month = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
    const day = String(tomorrow.getUTCDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}
