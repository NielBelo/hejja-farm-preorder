'use client';

export default function SelectorCard({
  name,
  description,
  selected,
  onClick,
}: any) {
  return (
    <div
      onClick={onClick}
      className={`
        p-4 rounded-lg border cursor-pointer
        transition-all duration-300
        hover:scale-[1.02] hover:shadow-xl
        ${
          selected
            ? 'bg-green-200 border-gray-200'
            : 'bg-gray-200/60 border-gray-200'
        }
      `}
    >
      <h3 className="text-xl font-bold mb-2">{name}</h3>
      <p className="text-gray-700">{description}</p>
    </div>
  );
}