"use client";

import { createContext, useContext, useState } from "react";

type CancellationNotice = {
    success: string;
    warning: string | null;
};

type OrderActionsContextType = {
    editingOrderId: number | null;
    startEditing: (orderId: number) => void;
    stopEditing: () => void;
    cancellationNotice: CancellationNotice | null;
    setCancellationNotice: (notice: CancellationNotice | null) => void;
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
    // A törlés visszaigazolása ide, a rendeléslistával együtt mindig
    // mountolt szülőbe kerül - a törölt rendelés kártyája (és annak helyi
    // state-je) a törlés utáni router.refresh() nyomán kikerül a szerver
    // által visszaadott rendelések közül (lásd a history oldal .neq("status",
    // "cancelled") szűrését), így egy a kártyán belüli helyi üzenet azonnal
    // elveszne az unmount miatt.
    const [cancellationNotice, setCancellationNotice] =
        useState<CancellationNotice | null>(null);

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
                cancellationNotice,
                setCancellationNotice,
            }}
        >
            {cancellationNotice && (
                <div className="mb-5 space-y-3">
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                        <p className="text-base text-center text-[rgb(49,171,2)]">
                            {cancellationNotice.success}
                        </p>
                    </div>
                    {cancellationNotice.warning && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                            <p className="text-center text-base text-amber-700">
                                {cancellationNotice.warning}
                            </p>
                        </div>
                    )}
                </div>
            )}
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