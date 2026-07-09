export default function OrderStep({
  step,
  title,
}: {
  step: number;
  title: string;
}) {
  return (
    <div className="bg-gray-200 rounded-md px-4 py-2 font-medium text-sm">
      #{step} {title}
    </div>
  );
}