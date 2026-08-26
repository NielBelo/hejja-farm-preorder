"use client";

import { createContext, useContext, useState } from "react";

type OrderActionsContextType = {
    editingOrderId: number | null;
    startEditing: (orderId: number) => void;
    stopEditing: () => void;
};

const OrderActionsContext =
    createContext<OrderActionsContextType | null>(null);

export function OrderActionsManager({
    children,
}: {
    children: React.ReactNode;
}) {
    const [editingOrderId, setEditingOrderId] =
        useState<number | null>(null);

    const startEditing = (orderId: number) => {
        setEditingOrderId(orderId);
    };

    const stopEditing = () => {
        setEditingOrderId(null);
    };

    return (
        <OrderActionsContext.Provider
            value={{
                editingOrderId,
                startEditing,
                stopEditing,
            }}
        >
            {children}
        </OrderActionsContext.Provider>
    );
}

export function useOrderActionsManager() {
    const context = useContext(OrderActionsContext);

    if (!context) {
        throw new Error(
            "useOrderActionsManager must be used inside OrderActionsManager"
        );
    }

    return context;
}