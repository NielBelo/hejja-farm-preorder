// A vásárlói vármegye-csoportok központi, egy helyen karbantartott
// felismerése. Ne szórjuk szét a `county === "..."` feltételeket a
// komponensekben/lib-ekben - mindenki ezt a helpert használja, hogy a három
// csoport (Békés, Bács-Kiskun, egyéb) kezelése egy helyről bővíthető és
// ellenőrizhető maradjon.

export const BEKES_COUNTY = "Békés";
export const BACS_KISKUN_COUNTY = "Bács-Kiskun";

export type CountyGroup = "bekes" | "bacsKiskun" | "other";

export function getCountyGroup(county?: string | null): CountyGroup {
    const trimmed = county?.trim();

    if (trimmed === BEKES_COUNTY) {
        return "bekes";
    }

    if (trimmed === BACS_KISKUN_COUNTY) {
        return "bacsKiskun";
    }

    return "other";
}

export function isBekesCounty(county?: string | null) {
    return getCountyGroup(county) === "bekes";
}

export function isBacsKiskunCounty(county?: string | null) {
    return getCountyGroup(county) === "bacsKiskun";
}

// A rendelési tételnél megjelenő megjegyzés-mező felirata Bács-Kiskun
// vármegyei vásárlóknál - a beviteli mező funkciója változatlan, csak ez a
// hozzá tartozó szöveg speciális ennél a csoportnál (mind az előrendelő
// oldalon, mind a saját rendelés utólagos módosításakor).
export const BACS_KISKUN_NOTE_LABEL =
    "Ha valaki jár erre aki a szállítást meg tudja oldani, kérjük a megjegyzés rovatba ezt jelezze! Egyébként mi szállítjuk házhoz előre egyeztetett időpontban.";
