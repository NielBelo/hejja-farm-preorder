import "server-only";

// Kemény védelem a szezonindítási értesítő küldése elé. Az emlékeztető
// kapcsolójától (REMINDER_EMAIL_SENDING_ENABLED) SZÁNDÉKOSAN független: az
// emlékeztető élesítése nem indíthat el tömeges szezonlevelet. Csak akkor
// küldhető ténylegesen, ha production környezetben fut ÉS a superadmin a
// karbantartási oldalon bekapcsolta a küldést (KV-ban tárolt kapcsoló, lásd
// lib/email/seasonLaunchSwitch.ts). A kapcsoló állapotát a hívó olvassa be és
// adja át, mert a KV-olvasás aszinkron.
export function isSeasonLaunchSendingBlocked(switchEnabled: boolean) {
    return process.env.NODE_ENV !== "production" || switchEnabled !== true;
}

// Teszteléshez: ha a SEASON_LAUNCH_TEST_RECIPIENT be van állítva (egy vagy
// több, vesszővel/pontosvesszővel elválasztott cím), a levél KIZÁRÓLAG ezeknek
// a (már regisztrált) címeknek megy, mindenki más kimarad.
//   - hiányzó/üres változó  -> null: nincs szűkítés (éles működés)
//   - nem üres, de érvényes cím nélküli érték (pl. ",") -> üres lista:
//     SENKINEK nem megy levél (elgépelés esetén sem szélesedhet ki a kör).
export function getSeasonLaunchTestRecipients(): string[] | null {
    const raw = process.env.SEASON_LAUNCH_TEST_RECIPIENT;
    if (raw === undefined || raw.trim() === "") {
        return null;
    }

    return raw
        .split(/[,;]/)
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.includes("@"));
}
