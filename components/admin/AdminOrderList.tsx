"use client";

import { useState } from "react";
import AdminOrderCard, {
    type AdminOrder,
} from "@/components/admin/AdminOrderCard";

type Product = {
    id: number;
    name: string;
    description: string | null;
    image_url: string | null;
};

type PackageOption = {
    id: number;
    name: string;
    description: string | null;
};

export default function AdminOrderList({
    orders,
    products,
    packages,
}: {
    orders: AdminOrder[];
    products: Product[];
    packages: PackageOption[];
}) {
    const [openOrderId, setOpenOrderId] = useState<number | null>(null);

    const handleToggle = (orderId: number) => {
        setOpenOrderId((currentId) =>
            currentId === orderId ? null : orderId
        );
    };

    return (
        <div className="space-y-3">
            {orders.map((order) => (
                <AdminOrderCard
                    key={order.id}
                    order={order}
                    products={products}
                    packages={packages}
                    isOpen={openOrderId === order.id}
                    onToggle={() => handleToggle(order.id)}
                />
            ))}
        </div>
    );
}