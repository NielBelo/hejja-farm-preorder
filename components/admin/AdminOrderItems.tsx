type AdminOrderItem = {
    id: number;
    product_id: number;
    package_id: number;
    quantity: number;
    size_preference: string | null;
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
    compact?: boolean;
};

export default function AdminOrderItems({
    items,
    compact = false,
}: AdminOrderItemsProps) {
    return (
        <div className="divide-y divide-gray-200">
            {items.map((item, index) => (
                <div
                    key={item.id}
                    className={`${compact ? "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5" : "py-3"} first:pt-0 last:pb-0`}
                >
                    {/* 1. sor: termék + mennyiség */}
                    <p className="font-medium text-sm text-gray-800">
                        <span className="mr-2 font-medium text-gray-800">
                            {index + 1}. tétel:
                        </span>

                        {item.products?.name ?? "Ismeretlen termék"}{" "}
                        {item.quantity} db
                    </p>

                    {/* 2. sor: részletek */}
                    <p className={`${compact ? "min-w-0 break-words" : "mt-1"} text-sm text-gray-500`}>
                        {item.packages?.name ?? "Nincs csomagolás"}

                        {item.size_preference && (
                            <>
                                <span className="mx-2 text-gray-500">
                                    ·
                                </span>

                                {item.size_preference}
                            </>
                        )}

                        {item.note && (
                            <>
                                <span className="mx-2 text-gray-500">
                                    ·
                                </span>

                                <span>
                                    Megjegyzés: {item.note}
                                </span>
                            </>
                        )}
                    </p>
                </div>
            ))}
        </div>
    );
}
