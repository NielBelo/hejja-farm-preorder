"use client";

import { useEffect, useRef } from "react";
import { useOrderActionsManager } from "@/components/OrderActionsManager";

type EditableOrderCardProps = {
    orderId: number;
    children: React.ReactNode;
};

export default function EditableOrderCard({
    orderId,
    children,
}: EditableOrderCardProps) {
    const { editingOrderId } = useOrderActionsManager();

    const isEditing = editingOrderId === orderId;
    const cardRef = useRef<HTMLDivElement>(null);
    const wasEditingRef = useRef(false);

    useEffect(() => {
        if (wasEditingRef.current && !isEditing) {
            cardRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        }

        wasEditingRef.current = isEditing;
    }, [isEditing]);

    return (
        <div
            ref={cardRef}
            className={`
            scroll-mt-24
            overflow-hidden rounded-xl bg-white
            transition-all duration-200
            ${isEditing
                    ? "border-2 border-blue-400 shadow-lg ring-2 ring-blue-100"
                    : "border border-gray-200 shadow-sm"
                }
        `}
        >
            {children}
        </div>
    );
}