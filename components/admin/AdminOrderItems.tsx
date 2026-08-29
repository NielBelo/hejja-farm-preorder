type AdminOrderItem = {
    id: number;
    product_id: number;
    package_id: number;
    quantity: number;
    size_preference: string;
    note: string | null;
    products: {
        id: number;
        name: string;
    } | null;
    packages: {
        id: number;
        name: string;
    } | null;
};

type AdminOrderItemsProps = {
    items: AdminOrderItem[];
};

export default function AdminOrderItems({
    items,
}: AdminOrderItemsProps) {
    const getSizeText = (sizePreference: string) => {
        if (
            sizePreference ===
            "Átlagostól inkább kisebbet kérek, ha lehet"
        ) {
            return "Átlagostól kisebb méret";
        }

        if (
            sizePreference ===
            "Átlagostól inkább nagyobbat kérek, ha lehet"
        ) {
            return "Átlagostól nagyobb méret";
        }

        return "Átlagos méret";
    };

    return (
        <div>
            {items.map((item, index) => (
                <div
                    key={item.id}
                    className={`
                        py-3
                        ${index !== items.length - 1
                            ? "border-b border-gray-200"
                            : ""
                        }
                    `}
                >
                    <div className="flex items-start gap-3">
                        {/* Tételszám */}
                        <div className="shrink-0 font-semibold text-gray-500">
                            {index + 1}.
                        </div>

                        {/* Tétel adatai */}
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                                <span className="font-semibold text-gray-700">
                                    {item.products?.name ?? "Ismeretlen termék"}
                                </span>

                                <span className="text-gray-300">•</span>

                                <span className="font-medium text-gray-700">
                                    {item.quantity} db
                                </span>

                                <span className="text-gray-300">•</span>

                                <span className="text-gray-600">
                                    {item.packages?.name ??
                                        "Ismeretlen csomagolás"}
                                </span>

                                <span className="text-gray-300">•</span>

                                <span className="text-gray-500">
                                    {getSizeText(item.size_preference)}
                                </span>
                            </div>

                            {item.note && (
                                <div className="mt-1 text-sm text-gray-500">
                                    <span className="font-medium">
                                        Megjegyzés:
                                    </span>{" "}
                                    {item.note}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}