import { SIZE_PREFERENCES } from "@/lib/sizePreferences";

const SMALL_SIZE = SIZE_PREFERENCES[1];
const LARGE_SIZE = SIZE_PREFERENCES[2];

/** Az adott napon még rendelhető kisebb/nagyobb méretű csirkék száma (null = nincs korlát). */
export type SizeAvailability = { small: number | null; large: number | null };

type SizeItem = {
    selectedProductId: number | null;
    quantity: number;
    touched: boolean;
    selectedNote: string;
};

/**
 * Az adott méretből még hátralévő darabszám az adott tétel szempontjából: a
 * napi keretből levonjuk a TÖBBI tétel ugyanilyen méretű mennyiségét.
 * null = az adott méretre nincs korlát. A megérintetlen, üres helyőrző nem
 * foglal (lásd lib/orderQuantity.ts).
 */
export function getSizeRemaining(
    items: SizeItem[],
    index: number,
    size: string,
    availability: SizeAvailability | null | undefined,
): number | null {
    const limit = size === SMALL_SIZE ? availability?.small : size === LARGE_SIZE ? availability?.large : null;
    if (limit === null || limit === undefined) return null;

    const used = items.reduce((sum, item, i) => {
        if (i === index || item.selectedNote !== size) return sum;
        if (item.selectedProductId === null && !item.touched) return sum;
        return sum + item.quantity;
    }, 0);

    return Math.max(0, limit - used);
}

export type SizeFitResult<T> = {
    items: T[];
    /** Hány tétel mennyisége csökkent a keretre. */
    reducedCount: number;
    /** Hány tétel maradt ki, mert az adott méretből már nem maradt hely. */
    removedCount: number;
    changed: boolean;
};

/**
 * A meglévő tételek igazítása egy másik nap méretkeretéhez (átvételi nap
 * váltásakor). A tételeken sorrendben osztjuk el a keretet: ami részben
 * belefér, annak a mennyisége a hátralévőre csökken; ami egyáltalán nem fér
 * bele (nincs több hely az adott méretből), az kimarad. A megérintetlen
 * helyőrzők és a korlátlan méretű (pl. átlagos) tételek változatlanok. Ha
 * egyetlen valódi tétel sem marad, üres listát adunk vissza (a szerkesztő
 * ilyenkor újra üres rendelést indít).
 */
export function fitItemsToSizeAvailability<T extends SizeItem>(
    items: T[],
    availability: SizeAvailability | null | undefined,
): SizeFitResult<T> {
    const used = { small: 0, large: 0 };
    const fitted: T[] = [];
    let reducedCount = 0;
    let removedCount = 0;

    for (const item of items) {
        const isPlaceholder = item.selectedProductId === null && !item.touched;
        const key = item.selectedNote === SMALL_SIZE ? "small" : item.selectedNote === LARGE_SIZE ? "large" : null;
        const limit = key ? availability?.[key] : null;

        if (isPlaceholder || key === null || limit === null || limit === undefined) {
            fitted.push(item);
            continue;
        }

        const remaining = Math.max(0, limit - used[key]);

        if (remaining === 0) {
            removedCount += 1;
            continue;
        }

        if (item.quantity > remaining) {
            fitted.push({ ...item, quantity: remaining });
            used[key] += remaining;
            reducedCount += 1;
        } else {
            fitted.push(item);
            used[key] += item.quantity;
        }
    }

    const hasRealItems = fitted.some((item) => !(item.selectedProductId === null && !item.touched));

    return {
        items: hasRealItems ? fitted : [],
        reducedCount,
        removedCount,
        changed: reducedCount + removedCount > 0,
    };
}
