type QuantityItem = {
    selectedProductId: number | null;
    quantity: number;
    touched: boolean;
};

/**
 * A megérintetlen, üres "Új tétel" helyőrző (nincs termék, nem módosították)
 * alapértelmezett 1 db-os mennyisége nem valódi foglalás, ezért nem számít bele
 * a többi tétel által felhasznált készletbe.
 */
const isUntouchedPlaceholder = (item: QuantityItem) =>
    item.selectedProductId === null && !item.touched;

/** A tényleges tételek összmennyisége (a helyőrző nélkül), pl. átvételi nap váltásakor. */
export function getRequiredQuantity(items: QuantityItem[]) {
    return items.reduce(
        (sum, item) => (isUntouchedPlaceholder(item) ? sum : sum + item.quantity),
        0,
    );
}

export function getRemainingQuantity(
    items: QuantityItem[],
    currentIndex: number,
    maxAvailableQuantity: number | null,
) {
    const used = items.reduce((sum, item, index) => {
        if (index === currentIndex || isUntouchedPlaceholder(item)) return sum;
        return sum + item.quantity;
    }, 0);

    return Math.max(1, (maxAvailableQuantity ?? 100) - used);
}
