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
