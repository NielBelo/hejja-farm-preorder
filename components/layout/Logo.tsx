import Image from "next/image";

export default function Logo() {
  return (
    <div className="flex items-center gap-3">
      <Image
        src="/images/logo2.png"
        alt="Héjja Ökofarm"
        width={35}
        height={35}
        className="opacity-90"
        priority
      />

      <h1 className="text-2xl font-bold text-gray-700">
        Héjja Ökofarm
      </h1>
    </div>
  );
}