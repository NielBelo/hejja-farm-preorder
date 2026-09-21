"use client";

import type { ReactNode } from "react";

type InfoModalProps = {
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: ReactNode;
};

export default function InfoModal({ title, subtitle, onClose, children }: InfoModalProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="flex w-full max-w-2xl max-h-[85vh] flex-col rounded-xl bg-white p-6 shadow-xl">
                <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
                {subtitle && (
                    <p className="mt-1 text-sm font-medium text-gray-500">{subtitle}</p>
                )}

                <div className="mt-4 space-y-5 overflow-y-auto pr-1 text-base leading-6 text-gray-600">
                    {children}
                </div>

                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-[rgb(92,113,190)] px-5 py-3 text-base font-semibold text-white hover:bg-[rgb(72,93,162)]"
                    >
                        Bezárás
                    </button>
                </div>
            </div>
        </div>
    );
}
