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

export function findIndividualPackaging(packages: PackagingOption[]) {
    return packages.find((pack) => normalizedName(pack.name).includes("egyedi"));
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
