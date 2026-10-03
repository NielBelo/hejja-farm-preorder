// A rendelési felület aktív átvételi napjának kiszámítása. Lejárt (vagy még
// nem kezdődött) rendelési időablaknál egyik vásárlócsoportnál sincs aktív
// nap, így a termékválasztás és a véglegesítés sem lesz elérhető - a
// normál ágnál a korábban kiválasztott nap is elveszik, a DUNAVECSE ágnál a
// technikai nap nem jelenik meg aktívként.
export type PickupDayLike = {
    id: number;
    is_active: boolean;
};

export function getDisplayPickupDay<T extends PickupDayLike>({
    isOrderingOpen,
    isBacsKiskun,
    selectedPickupDay,
    dunavecsePickupDay,
}: {
    isOrderingOpen: boolean;
    isBacsKiskun: boolean;
    selectedPickupDay: T | null;
    dunavecsePickupDay: T | null;
}): T | null {
    if (!isOrderingOpen) {
        return null;
    }

    if (isBacsKiskun) {
        return dunavecsePickupDay?.is_active ? dunavecsePickupDay : null;
    }

    return selectedPickupDay;
}
