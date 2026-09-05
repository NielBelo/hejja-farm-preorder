"use client";

import { useEffect, useRef, useState } from "react";
import { useOrderActionsManager } from "@/components/OrderActionsManager";

const CLEAR_LINK_HIGHLIGHT_EVENT = "order-card-interaction";

type EditableOrderCardProps = {
    orderId: number;
    focusOnMount?: boolean;
    children: React.ReactNode;
};

export default function EditableOrderCard({
    orderId,
    focusOnMount = false,
    children,
}: EditableOrderCardProps) {
    const { editingOrderId } = useOrderActionsManager();

    const isEditing = editingOrderId === orderId;
    const cardRef = useRef<HTMLDivElement>(null);
    const wasEditingRef = useRef(false);
    const [isLinkHighlighted, setIsLinkHighlighted] = useState(focusOnMount);

    useEffect(() => {
        if (!focusOnMount) {
            return;
        }

        const frameId = requestAnimationFrame(() => {
            cardRef.current?.scrollIntoView({
                block: "start",
            });

            const url = new URL(window.location.href);
            url.searchParams.delete("focusOrder");
            url.hash = "";
            window.history.replaceState(
                window.history.state,
                "",
                `${url.pathname}${url.search}`,
            );
        });

        return () => cancelAnimationFrame(frameId);
    }, [focusOnMount]);

    useEffect(() => {
        const clearHighlight = () => setIsLinkHighlighted(false);

        window.addEventListener(CLEAR_LINK_HIGHLIGHT_EVENT, clearHighlight);

        return () => {
            window.removeEventListener(CLEAR_LINK_HIGHLIGHT_EVENT, clearHighlight);
        };
    }, []);

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
            id={`order-${orderId}`}
            ref={cardRef}
            data-order-card
            onClick={() => window.dispatchEvent(new Event(CLEAR_LINK_HIGHLIGHT_EVENT))}
            className={`
            scroll-mt-24
            overflow-hidden rounded-xl bg-white
            transition-all duration-200
            ${isEditing || isLinkHighlighted
                    ? "border-2 border-blue-400 shadow-lg ring-2 ring-blue-100"
                    : "border border-gray-200 shadow-sm"
                }
        `}
        >
            {children}
        </div>
    );
}
