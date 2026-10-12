// Az Előzmények oldalon a Módosítás / Törlés műveletek csak akkor érhetők el,
// ha EGYSZERRE teljesül:
//   1. a rendelés átvételi napja még nem járt le (isPickupCurrent),
//   2. a rendelés az AKTUÁLIS (is_active) szezonhoz tartozik,
//   3. a szezon előrendelési időablaka nyitva van (useOrderWindow - ugyanaz a
//      szabály, mint a rendelési folyamatban).
// Szerveroldalon az update_order / cancel_order RPC a nem admin felhasználónál
// az időablakot ellenőrzi; az aktív szezon feltétel csak a megjelenítést érinti.

export function isOrderInActiveSeason(
    orderSeasonParameterId: number | null | undefined,
    activeSeasonId: number | null | undefined,
): boolean {
    return orderSeasonParameterId != null
        && activeSeasonId != null
        && orderSeasonParameterId === activeSeasonId;
}

export function canChangeOrder({
    isPickupCurrent,
    isActiveSeason,
    isWindowOpen,
}: {
    isPickupCurrent: boolean;
    isActiveSeason: boolean;
    isWindowOpen: boolean;
}): boolean {
    return isPickupCurrent && isActiveSeason && isWindowOpen;
}
