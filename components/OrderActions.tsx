"use client";

type OrderActionsProps = {
  orderId: number;
  publicOrderNumber: string;
};

export default function OrderActions({
  orderId,
  publicOrderNumber,
}: OrderActionsProps) {
  const handleEdit = () => {
    console.log("Módosítandó rendelés:", {
      orderId,
      publicOrderNumber,
    });
  };

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={handleEdit}
        className="
          rounded-lg border border-gray-300
          px-4 py-2 text-sm
          text-gray-600
          transition-colors
          hover:bg-gray-50
          hover:text-gray-800
        "
      >
        Módosítás
      </button>

      <button
        type="button"
        className="
          rounded-lg border border-red-200
          px-4 py-2 text-sm
          text-red-500
          transition-colors
          hover:bg-red-50
          hover:text-red-600
        "
      >
        Rendelés törlése
      </button>
    </div>
  );
}