"use client";

// Átvételi nap váltásakor jelenik meg, ha az új napon kevesebb hely van a
// kisebb/nagyobb méretű csirkékből, mint a már megadott tételek (lásd
// lib/sizeAvailability.ts fitItemsToSizeAvailability).
export default function SizeFitDialog({
    reducedCount,
    removedCount,
    onConfirm,
    onCancel,
}: {
    reducedCount: number;
    removedCount: number;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const changes = [
        reducedCount > 0 ? `${reducedCount} tétel mennyisége csökken` : null,
        removedCount > 0 ? `${removedCount} tétel pedig kimarad a rendelésből` : null,
    ].filter(Boolean);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-xl">
                <h2 className="text-2xl font-semibold text-gray-800">Figyelem!</h2>

                <p className="mt-4 text-lg leading-7 text-gray-600">
                    A kiválasztott átvételi napon a kisebb vagy nagyobb méretű csirkékből kevesebb rendelhető, mint a
                    jelenlegi tételekben szerepel. Ha folytatja, {changes.join(", ")}.
                </p>

                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg border border-gray-300 px-5 py-3 text-base font-semibold text-gray-700 hover:bg-gray-100"
                    >
                        Mégse
                    </button>

                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded-lg bg-[rgb(67,133,45)] px-5 py-3 text-base font-semibold text-white hover:brightness-95"
                    >
                        Váltás a módosításokkal
                    </button>
                </div>
            </div>
        </div>
    );
}
