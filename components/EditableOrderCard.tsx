"use client";

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

return (
    <div
        className={`
            overflow-hidden rounded-xl bg-white
            transition-all duration-200
            ${
                isEditing
                    ? "border-2 border-blue-400 shadow-lg ring-2 ring-blue-100"
                    : "border border-gray-200 shadow-sm"
            }
        `}
    >
        {children}
    </div>
);
}