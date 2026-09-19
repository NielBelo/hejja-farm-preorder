export type PackagingProduct = {
    id: number;
    name: string;
};

export type PackagingOption = {
    id: number;
    name: string;
};

function normalizedName(name: string) {
    return name.trim().toLocaleLowerCase("hu-HU");
}

export function isChoppedChicken(product: PackagingProduct | null | undefined) {
    return normalizedName(product?.name ?? "").includes("darabolt");
}

export function canChoosePackaging(
    product: PackagingProduct | null | undefined,
    quantity: number,
) {
    return isChoppedChicken(product) && quantity >= 5;
}

// Az "egyedi" (történeti/eredeti elnevezés) és az "egyenként" (jelenlegi élő
// adatbázis-elnevezés) egyaránt ugyanazt a csomagolást azonosítja - a
// packages.name szabadon szerkeszthető admin-mező, a kettő között a
// tényleges DB-tartalom átnevezés miatt tér el.
function isIndividualPackagingName(name: string) {
    const normalized = normalizedName(name);
    return normalized.includes("egyedi") || normalized.includes("egyenként");
}

export function findIndividualPackaging(packages: PackagingOption[]) {
    return packages.find((pack) => isIndividualPackagingName(pack.name));
}

export function normalizePackageId({
    product,
    quantity,
    selectedPackageId,
    packages,
}: {
    product: PackagingProduct | null | undefined;
    quantity: number;
    selectedPackageId: number | null;
    packages: PackagingOption[];
}) {
    if (!product) {
        return null;
    }

    if (canChoosePackaging(product, quantity)) {
        return packages.some((pack) => pack.id === selectedPackageId)
            ? selectedPackageId
            : findIndividualPackaging(packages)?.id ?? null;
    }

    return findIndividualPackaging(packages)?.id ?? null;
}
